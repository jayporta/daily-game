import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkModels, readCatalog, shouldCheckModels } from '#scripts/check-models.ts';
import type { ModelsConfig } from '#scripts/lib/config/models.ts';
import { createPaths } from '#scripts/lib/paths.ts';

// Literal caps rather than ones derived from MIN_OUTPUT_TOKENS: a test whose
// inputs move with the constant it guards can never fail when that constant
// does. 8k is the tier that truncated a game and motivated the floor.
const BIG = 65_536;
const TOO_SMALL = 8_192;

/** A scratch repo holding only the rotation config under test. */
function scratchRoot(t: { after(fn: () => void): void }, config: ModelsConfig): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-models-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(createPaths(dir).modelsConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return dir;
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

test('shouldCheckModels only fires on a day that produced no game', () => {
  const failed = [{ date: '2026-09-10', status: 'failed_kept_previous' as const, model: 'm' }];
  const published = [{ date: '2026-09-10', status: 'published' as const, model: 'm' }];

  assert.equal(shouldCheckModels(failed, '2026-09-10'), true);
  assert.equal(shouldCheckModels(published, '2026-09-10'), false);
  assert.equal(shouldCheckModels(failed, '2026-09-11'), false);
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
