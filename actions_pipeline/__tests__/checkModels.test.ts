import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  checkModels,
  MIN_UNRELIABLE_DAYS,
  modelReliability,
  readCatalog,
  shouldCheckModels,
  unreliableModelIds,
} from '#actions_pipeline/checkModels.ts';
import type { ModelsConfig } from '#actions_pipeline/lib/config/models.ts';
import type { FailedEntry, HistoryGameEntry } from '#actions_pipeline/lib/historyStore.ts';
import { createPaths } from '#actions_pipeline/lib/paths.ts';
import {
  FAILED_ENTRY,
  GENERATION_CONFIG,
  PUBLISHED_ENTRY,
} from '#actions_pipeline/lib/testFixtures.ts';

// Literal caps rather than ones derived from MIN_OUTPUT_TOKENS: a test whose
// inputs move with the constant it guards can never fail when that constant
// does. 8k is the tier that truncated a game and motivated the floor.
const BIG = 65_536;
const TOO_SMALL = 8_192;

// checkModels() trims history to historyHotWindowDays counted back from its
// clock, so dated fixtures below would age out of the window and quietly
// stop testing anything. Pinning the clock keeps them inside it.
const NOW = new Date('2026-09-05T00:00:00Z');

/**
 * A scratch repo holding the rotation config, and optionally a hot window
 * for the reliability checks to read. `config/generation.json` is always
 * written from the fixture — checkModels() now trims history to its
 * `historyHotWindowDays` before judging reliability.
 */
function scratchRoot(
  t: { after(fn: () => void): void },
  config: ModelsConfig,
  historyEntries: readonly HistoryGameEntry[] = [],
): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-models-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = createPaths(dir);
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(paths.modelsConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  writeFileSync(paths.generationConfig, `${JSON.stringify(GENERATION_CONFIG, null, 2)}\n`, 'utf8');
  if (historyEntries.length > 0) {
    mkdirSync(join(dir, 'history'), { recursive: true });
    writeFileSync(paths.historyGames, `${JSON.stringify(historyEntries, null, 2)}\n`, 'utf8');
  }
  return dir;
}

/**
 * A failed hot-window day, with `attemptModels` filled from `models` and
 * `failureKinds` defaulting to `generation-call` for every attempt unless
 * `over` replaces it.
 */
function failedDay(
  date: string,
  models: readonly string[],
  over: Partial<FailedEntry> = {},
): FailedEntry {
  return {
    date,
    status: 'failed_kept_previous',
    model: models[models.length - 1] ?? 'a/model:free',
    attempts: models.length,
    failureReasons: models.map((id) => `attempt (${id}): generation call failed`),
    failureKinds: models.map(() => 'generation-call'),
    attemptModels: [...models],
    ...over,
  };
}

function entry(id: string, maxOutputTokens = BIG, outputModalities: string[] = ['text']): unknown {
  return {
    id,
    name: id,
    architecture: { output_modalities: outputModalities },
    top_provider: { max_completion_tokens: maxOutputTokens },
  };
}

function catalog(entries: unknown[]): typeof fetch {
  return async () => Response.json({ data: entries });
}

const CONFIG: ModelsConfig = {
  moderationModel: 'mod/model:free',
  models: [
    { id: 'a/model:free', active: true, provider: 'openrouter' },
    { id: 'b/model:free', active: true, provider: 'openrouter' },
  ],
};

function readConfig(root: string): ModelsConfig {
  return JSON.parse(readFileSync(createPaths(root).modelsConfig, 'utf8'));
}

test('shouldCheckModels fires on a failed day and on a published day that lost an attempt', () => {
  const failed = [{ ...FAILED_ENTRY, date: '2026-09-10' }];
  const published = [{ ...PUBLISHED_ENTRY, date: '2026-09-10' }];

  assert.equal(shouldCheckModels(failed, '2026-09-10'), true);
  assert.equal(shouldCheckModels(published, '2026-09-10'), false);
  assert.equal(shouldCheckModels(failed, '2026-09-11'), false);

  // A model rescued by a later one leaves its evidence on a day that
  // published, and nothing reads that evidence unless the gate opens for
  // such a day too.
  const rescued: HistoryGameEntry[] = [
    {
      ...PUBLISHED_ENTRY,
      date: '2026-09-10',
      attemptModels: ['b/model:free'],
      failureKinds: ['generation-call'],
    },
  ];
  assert.equal(shouldCheckModels(rescued, '2026-09-10'), true);
});

test('readCatalog rejects a response that is not the documented shape', () => {
  assert.throws(() => readCatalog({ models: [] }), /not a \{ data/);
  assert.throws(() => readCatalog(null), /not a \{ data/);
});

// Losing a model that is merely described oddly would read as a
// disappearance and prune a working entry.
test('an entry too partial to judge still counts as alive', () => {
  const { liveIds, usable } = readCatalog({ data: [{ id: 'odd/model:free' }] });

  assert.equal(liveIds.has('odd/model:free'), true);
  assert.deepEqual(usable, []);
});

test('a rotation that is entirely still listed is left alone', async (t) => {
  const root = scratchRoot(t, CONFIG);
  const before = readFileSync(createPaths(root).modelsConfig, 'utf8');

  const result = await checkModels({
    root,
    fetchImpl: catalog([entry('a/model:free'), entry('b/model:free'), entry('mod/model:free')]),
  });

  assert.equal(result.status, 'all-live');
  assert.equal(readFileSync(createPaths(root).modelsConfig, 'utf8'), before);
});

test('a model that has gone is dropped and the roomiest candidate takes its place', async (t) => {
  const root = scratchRoot(t, CONFIG);

  const result = await checkModels({
    root,
    fetchImpl: catalog([
      entry('b/model:free'),
      entry('mod/model:free'),
      entry('small/model:free', TOO_SMALL),
      entry('roomy/model:free', BIG),
    ]),
  });

  assert.equal(result.status, 'updated');
  const written = readConfig(root);
  assert.deepEqual(
    written.models.map((m) => m.id),
    ['b/model:free', 'roomy/model:free'],
  );
});

// The 8k tier truncates a game mid-bundle, which the extractor can only
// report as a missing block.
test('a candidate too small to hold a game is passed over', async (t) => {
  const root = scratchRoot(t, CONFIG);

  await checkModels({
    root,
    fetchImpl: catalog([
      entry('b/model:free'),
      entry('mod/model:free'),
      entry('tiny/model:free', TOO_SMALL),
    ]),
  });

  assert.deepEqual(
    readConfig(root).models.map((m) => m.id),
    ['b/model:free'],
  );
});

test('a candidate that does not answer in text is passed over', async (t) => {
  const root = scratchRoot(t, CONFIG);

  await checkModels({
    root,
    fetchImpl: catalog([
      entry('b/model:free'),
      entry('mod/model:free'),
      entry('audio/model:free', BIG, ['text', 'audio']),
    ]),
  });

  assert.deepEqual(
    readConfig(root).models.map((m) => m.id),
    ['b/model:free'],
  );
});

// A generator that moderates itself is not a second opinion, and the config
// validator rejects it outright.
test('a moderation model that has gone is replaced without joining the rotation', async (t) => {
  const root = scratchRoot(t, CONFIG);

  const result = await checkModels({
    root,
    fetchImpl: catalog([
      entry('b/model:free'),
      entry('first/model:free', BIG),
      entry('second/model:free', BIG - 1),
    ]),
  });

  assert.equal(result.status, 'updated');
  const written = readConfig(root);
  assert.notEqual(written.moderationModel, 'mod/model:free');
  assert.ok(!written.models.some((m) => m.id === written.moderationModel));
});

// npm run validate runs before any API call, so a config left broken here
// would take out the next day's run before it started.
test('a prune that would empty the rotation writes nothing', async (t) => {
  const root = scratchRoot(t, CONFIG);
  const before = readFileSync(createPaths(root).modelsConfig, 'utf8');

  const result = await checkModels({
    root,
    fetchImpl: catalog([entry('mod/model:free')]),
  });

  assert.equal(result.status, 'refused');
  assert.equal(readFileSync(createPaths(root).modelsConfig, 'utf8'), before);
});

// The rotation needs no refill here, so the moderator takes the first
// candidate rather than one past a slice of nothing.
test('a healthy rotation is left alone when only the moderator has gone', async (t) => {
  const root = scratchRoot(t, CONFIG);

  const result = await checkModels({
    root,
    fetchImpl: catalog([
      entry('a/model:free'),
      entry('b/model:free'),
      entry('fresh/model:free', BIG),
    ]),
  });

  assert.equal(result.status, 'updated');
  const written = readConfig(root);
  assert.equal(written.moderationModel, 'fresh/model:free');
  assert.deepEqual(
    written.models.map((m) => m.id),
    ['a/model:free', 'b/model:free'],
  );
});

// A moderator OpenRouter no longer knows fails every attempt closed, so a
// rotation pruned around it would read as repaired while nothing works.
test('a moderation model that cannot be replaced refuses the whole change', async (t) => {
  const root = scratchRoot(t, CONFIG);
  const before = readFileSync(createPaths(root).modelsConfig, 'utf8');

  const result = await checkModels({
    root,
    // 'a' and the moderator are both gone, and one candidate refills 'a'.
    fetchImpl: catalog([entry('b/model:free'), entry('only/model:free', BIG)]),
  });

  assert.equal(result.status, 'refused');
  assert.match(
    result.status === 'refused' ? result.reason : '',
    /moderationModel mod\/model:free is gone/,
  );
  assert.equal(readFileSync(createPaths(root).modelsConfig, 'utf8'), before);
});

test('a dry run reports what would change and writes nothing', async (t) => {
  const root = scratchRoot(t, CONFIG);
  const before = readFileSync(createPaths(root).modelsConfig, 'utf8');

  const result = await checkModels({
    root,
    dryRun: true,
    fetchImpl: catalog([entry('b/model:free'), entry('mod/model:free'), entry('new/model:free')]),
  });

  assert.equal(result.status, 'updated');
  assert.equal(readFileSync(createPaths(root).modelsConfig, 'utf8'), before);
});

// A run that cannot see the catalogue must not conclude every model has gone.
test('an unreachable catalogue fails rather than pruning everything', async (t) => {
  const root = scratchRoot(t, CONFIG);

  await assert.rejects(
    () => checkModels({ root, fetchImpl: async () => new Response('', { status: 503 }) }),
    /could not load the OpenRouter catalogue \(503\)/,
  );
});

test('modelReliability ignores a failed day recorded before attemptModels existed', () => {
  assert.deepEqual([...modelReliability([FAILED_ENTRY])], []);
});

test('modelReliability ignores a quota-exhausted day', () => {
  const entries: HistoryGameEntry[] = [
    failedDay('2026-09-01', ['a/model:free'], { quotaExhausted: true }),
  ];

  assert.deepEqual([...modelReliability(entries)], []);
});

// The real shape of 2026-09-08: seven distinct models, one attempt each, six
// refused by the provider — a rotation-wide outage, not evidence against any
// one of the six.
test('modelReliability ignores a day where most of the distinct models attempted failed the generation call', () => {
  const models = [
    'a/model:free',
    'b/model:free',
    'c/model:free',
    'd/model:free',
    'e/model:free',
    'f/model:free',
    'g/model:free',
  ];
  const entries: HistoryGameEntry[] = [
    failedDay('2026-09-08', models, {
      failureKinds: [
        'generation-call',
        'generation-call',
        'generation-call',
        'generation-call',
        'generation-call',
        'generation-call',
        'extract',
      ],
    }),
  ];

  assert.deepEqual([...modelReliability(entries)], []);
});

// A forced run is pinned to a single id, so however many times it failed
// that day, only one distinct model was exercised — it can never look like
// a rotation-wide outage. Mixed kinds across the three attempts also prove
// the day is keyed to the first attempt, not overwritten by a later one.
test("modelReliability counts a forced run's several attempts on one model as a single day, keyed to its first", () => {
  const entries: HistoryGameEntry[] = [
    failedDay('2026-09-01', ['a/model:free', 'a/model:free', 'a/model:free'], {
      failureKinds: ['extract', 'generation-call', 'generation-call'],
    }),
  ];

  assert.deepEqual(modelReliability(entries).get('a/model:free'), {
    days: 1,
    generationCallDays: 0,
  });
});

// The gap Copilot flagged on PR #13: a model that fails its own attempt
// every day but is always rescued by a later model in the rotation never
// produces a failed_kept_previous entry, so without reading this evidence
// from a published day too, the tally would never see it.
test("modelReliability counts a published day's earlier failed attempt against the model that lost, not the one that published", () => {
  const entries: HistoryGameEntry[] = [
    {
      ...PUBLISHED_ENTRY,
      date: '2026-09-01',
      model: 'b/model:free',
      failureKinds: ['generation-call'],
      attemptModels: ['a/model:free'],
    },
  ];

  assert.deepEqual(modelReliability(entries).get('a/model:free'), {
    days: 1,
    generationCallDays: 1,
  });
  assert.equal(modelReliability(entries).get('b/model:free'), undefined);
});

// The rotation-wide filter is for days that produced nothing. Applied to a
// published day it discarded the evidence as fast as it was recorded: two
// losing attempts are a 2/2 generation-call ratio, well past
// ROTATION_WIDE_FAILURE_RATE, even though the day ended in a game.
test('modelReliability counts a published day where several models failed before the winner', () => {
  const entries: HistoryGameEntry[] = [
    {
      ...PUBLISHED_ENTRY,
      date: '2026-09-01',
      model: 'c/model:free',
      failureKinds: ['generation-call', 'generation-call'],
      attemptModels: ['a/model:free', 'b/model:free'],
    },
  ];

  assert.deepEqual(modelReliability(entries).get('a/model:free'), {
    days: 1,
    generationCallDays: 1,
  });
  assert.deepEqual(modelReliability(entries).get('b/model:free'), {
    days: 1,
    generationCallDays: 1,
  });
});

test('modelReliability ignores a published day whose earlier attempt hit a capacity refusal', () => {
  const entries: HistoryGameEntry[] = [
    {
      ...PUBLISHED_ENTRY,
      date: '2026-09-01',
      failureKinds: ['generation-call'],
      attemptModels: ['a/model:free'],
      quotaAffected: true,
    },
  ];

  assert.deepEqual([...modelReliability(entries)], []);
});

test('unreliableModelIds needs MIN_UNRELIABLE_DAYS of evidence before naming a model', () => {
  const entries: HistoryGameEntry[] = [];
  for (let day = 1; day < MIN_UNRELIABLE_DAYS; day += 1) {
    entries.push(failedDay(`2026-09-0${day}`, ['a/model:free']));
  }

  assert.deepEqual([...unreliableModelIds(entries)], []);

  entries.push(failedDay(`2026-09-0${MIN_UNRELIABLE_DAYS}`, ['a/model:free']));
  assert.deepEqual([...unreliableModelIds(entries)], ['a/model:free']);
});

test('unreliableModelIds spares a model that published inside the same window', () => {
  const entries: HistoryGameEntry[] = [
    { ...PUBLISHED_ENTRY, date: '2026-08-30', model: 'a/model:free' },
    failedDay('2026-09-01', ['a/model:free']),
    failedDay('2026-09-02', ['a/model:free']),
    failedDay('2026-09-03', ['a/model:free']),
  ];

  assert.deepEqual([...unreliableModelIds(entries)], []);
});

test('checkModels drops a still-listed model for unreliability and refills its slot', async (t) => {
  const history = [
    failedDay('2026-09-01', ['b/model:free']),
    failedDay('2026-09-02', ['b/model:free']),
    failedDay('2026-09-03', ['b/model:free']),
  ];
  const root = scratchRoot(t, CONFIG, history);

  const result = await checkModels({
    root,
    now: NOW,
    fetchImpl: catalog([
      entry('a/model:free'),
      entry('b/model:free'),
      entry('mod/model:free'),
      entry('fresh/model:free', BIG),
    ]),
  });

  assert.equal(result.status, 'updated');
  assert.deepEqual(result.status === 'updated' ? result.removedUnreliable : [], ['b/model:free']);
  const written = readConfig(root);
  assert.deepEqual(
    written.models.map((m) => m.id),
    ['a/model:free', 'fresh/model:free'],
  );
});

// readHotWindow reads the entire file; historyHotWindowDays is the cutoff a
// rollup applies to it, not a bound games.json enforces on itself (see that
// field's own doc comment). checkModels() has to apply the cutoff itself, or
// a rollup that has not run in a while lets ancient evidence prune a model.
test('checkModels ignores reliability evidence older than the configured hot window', async (t) => {
  const history = [
    failedDay('2020-01-01', ['b/model:free']),
    failedDay('2020-01-02', ['b/model:free']),
    failedDay('2020-01-03', ['b/model:free']),
  ];
  const root = scratchRoot(t, CONFIG, history);

  const result = await checkModels({
    root,
    now: NOW,
    fetchImpl: catalog([entry('a/model:free'), entry('b/model:free'), entry('mod/model:free')]),
  });

  assert.equal(result.status, 'all-live');
});

// b/model:free was already pruned out of config.models by an earlier run —
// this run's config no longer lists it at all — but the hot window still
// holds the evidence, and the catalogue still lists it live with the
// largest output cap of any candidate. Without excluding unreliable ids
// from the replacement pool, it would be sorted first and handed straight
// back the slot a different dead model just opened.
test('checkModels never offers an already-pruned id back as a replacement', async (t) => {
  const configWithoutB: ModelsConfig = {
    moderationModel: 'mod/model:free',
    models: [{ id: 'a/model:free', active: true, provider: 'openrouter' }],
  };
  const history = [
    failedDay('2026-09-01', ['b/model:free']),
    failedDay('2026-09-02', ['b/model:free']),
    failedDay('2026-09-03', ['b/model:free']),
  ];
  const root = scratchRoot(t, configWithoutB, history);

  const result = await checkModels({
    root,
    now: NOW,
    // a/model:free is missing from the catalogue (dead), opening one slot.
    fetchImpl: catalog([
      entry('mod/model:free'),
      entry('b/model:free', BIG),
      entry('fresh/model:free', BIG - 1),
    ]),
  });

  assert.equal(result.status, 'updated');
  const written = readConfig(root);
  assert.deepEqual(
    written.models.map((m) => m.id),
    ['fresh/model:free'],
  );
});

test('checkModels returns all-live when nothing is delisted and nothing is unreliable', async (t) => {
  // Two days of failure is one short of MIN_UNRELIABLE_DAYS.
  const history = [
    failedDay('2026-09-01', ['b/model:free']),
    failedDay('2026-09-02', ['b/model:free']),
  ];
  const root = scratchRoot(t, CONFIG, history);
  const before = readFileSync(createPaths(root).modelsConfig, 'utf8');

  const result = await checkModels({
    root,
    now: NOW,
    fetchImpl: catalog([entry('a/model:free'), entry('b/model:free'), entry('mod/model:free')]),
  });

  assert.equal(result.status, 'all-live');
  assert.equal(readFileSync(createPaths(root).modelsConfig, 'utf8'), before);
});

// Regression for a real ordering bug: computing the rotation-wide check over
// only unproven models let a day with exactly one unproven model dodge the
// check outright and take a full strike for what was still a provider-wide
// outage — the worst case being the newest addition to the rotation, which
// is the model least likely to have published anywhere else yet.
test('unreliableModelIds does not blame the one unproven model on an outage day the rest of the rotation also failed', () => {
  const provenIds = [
    'a/model:free',
    'b/model:free',
    'c/model:free',
    'd/model:free',
    'e/model:free',
    'f/model:free',
  ];
  const entries: HistoryGameEntry[] = provenIds.map((id, index) => ({
    ...PUBLISHED_ENTRY,
    date: `2026-08-2${index}`,
    model: id,
  }));
  for (const date of ['2026-09-01', '2026-09-02', '2026-09-03']) {
    entries.push(failedDay(date, [...provenIds, 'g/model:free']));
  }

  assert.deepEqual([...unreliableModelIds(entries)], []);
});

// Regression: a per-day quotaExhausted flag only fires when every attempt
// hit the account's cap. A day that hit it for some attempts and failed
// ordinarily for others used to count in full, letting the trailing models
// in rotation order take a generation-call strike for the account's quota.
// A single-model day isolates this from the rotation-wide check, which
// would otherwise also exclude a multi-model day for an unrelated reason.
test('modelReliability ignores a day the account ran out of quota for only some attempts', () => {
  const entries: HistoryGameEntry[] = [
    failedDay('2026-09-01', ['a/model:free'], { quotaAffected: true }),
  ];

  assert.deepEqual([...modelReliability(entries)], []);
});
