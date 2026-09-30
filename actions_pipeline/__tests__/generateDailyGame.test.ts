import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { FORCED_MODEL_ATTEMPTS, generateDailyGame } from '#actions_pipeline/generateDailyGame.ts';
import type { GenerationConfig } from '#actions_pipeline/lib/config/generation.ts';
import { loadGenresConfig } from '#actions_pipeline/lib/config/genres.ts';
import { loadGuardrails } from '#actions_pipeline/lib/config/guardrails.ts';
import type { ModelsConfig } from '#actions_pipeline/lib/config/models.ts';
import type { HistorySummary } from '#actions_pipeline/lib/historyStore.ts';
import { EMPTY_SUMMARY } from '#actions_pipeline/lib/historyStore.ts';
import { createMockOpenRouterClient } from '#actions_pipeline/lib/openRouterClient.mock.ts';
import {
  type CompletionRequest,
  type OpenRouterClient,
  OpenRouterHttpError,
} from '#actions_pipeline/lib/openRouterClient.ts';
import {
  GENERATION_CONFIG,
  loadFixture,
  scriptedClient,
} from '#actions_pipeline/lib/testFixtures.ts';
import { isModerationRequest } from '#actions_pipeline/moderate.ts';
import { MAX_MODERATION_FALLBACKS } from '#actions_pipeline/runAttempt.ts';
import { createSmokeTester, type SmokeTester } from '#actions_pipeline/smokeTest.ts';

const GUARDRAILS = loadGuardrails();
const GENRES = loadGenresConfig();

const MODELS: ModelsConfig = {
  moderationModel: 'mod/model:free',
  models: [
    { id: 'a/model:free', active: true, provider: 'openrouter' },
    { id: 'b/model:free', active: true, provider: 'openrouter' },
    { id: 'c/model:free', active: true, provider: 'openrouter' },
  ],
};

// Deliberately more active models than FORCED_MODEL_ATTEMPTS, and one inactive entry:
// only a pool of a different size than the forced cap can tell the two apart.
const WIDE_MODELS: ModelsConfig = {
  moderationModel: 'mod/model:free',
  models: [
    { id: 'a/model:free', active: true, provider: 'openrouter' },
    { id: 'b/model:free', active: true, provider: 'openrouter' },
    { id: 'skipped/model:free', active: false, provider: 'openrouter' },
    { id: 'c/model:free', active: true, provider: 'openrouter' },
    { id: 'd/model:free', active: true, provider: 'openrouter' },
    { id: 'e/model:free', active: true, provider: 'openrouter' },
  ],
};

// Remixing is off so a run is deterministic; nothing else differs.
const GENERATION: GenerationConfig = { ...GENERATION_CONFIG, remixProbability: 0 };

const SUMMARY: HistorySummary = EMPTY_SUMMARY;

let smokeTester: SmokeTester;

before(async () => {
  smokeTester = await createSmokeTester();
});

after(async () => {
  await smokeTester?.close();
});

function baseParams() {
  return {
    modelsConfig: MODELS,
    genres: GENRES,
    guardrails: GUARDRAILS,
    generationConfig: GENERATION,
    historyEntries: [],
    summary: SUMMARY,
    smokeTester,
  };
}

test('succeeds on the first attempt with a good response', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('goodMaze')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 1);
  assert.equal(result.meta.genre, 'maze-adventure');
  assert.equal(result.model, 'a/model:free');
});

test('retries after a JS-error bundle and succeeds on the second attempt', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('badJsError'), loadFixture('goodMaze')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 2);
  // The failed first attempt is not lost just because the day succeeded —
  // checkModels.ts's reliability tally reads this from a published day too.
  if (result.status === 'success') {
    assert.deepEqual(result.kinds, ['smoke-js-error']);
    assert.deepEqual(result.attemptModels, ['a/model:free']);
    assert.equal(result.quotaAffected, false);
  }
});

test('a successful run reports no prior failures when the first attempt wins', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('goodMaze')]),
  });

  assert.equal(result.status, 'success');
  if (result.status === 'success') {
    assert.deepEqual(result.kinds, []);
    assert.deepEqual(result.attemptModels, []);
    assert.equal(result.quotaAffected, false);
  }
});

test('retries after an unparseable response', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('badMalformedBlocks'), loadFixture('goodPlatformer')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 2);
});

// A truncated response loses its closing fence first, which extractBundle
// reports identically to a model that never wrote the block at all — the
// stop reason is what tells the two apart in the recorded failure.
test('an extraction failure caused by truncation names the output cap, not just the missing block', async () => {
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete', model };
      return { text: loadFixture('badMalformedBlocks'), stop: 'truncated', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client, forceModel: 'a/model:free' });

  assert.equal(result.status, 'failed_kept_previous');
  for (const reason of result.reasons) {
    assert.match(reason, /could not extract bundle/);
    assert.match(reason, /response truncated at the output cap/);
  }
});

test('gives up once the model pool is exhausted and keeps the previous game', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([
      loadFixture('badJsError'),
      loadFixture('badFetchAttempt'),
      loadFixture('badMalformedBlocks'),
    ]),
  });

  assert.equal(result.status, 'failed_kept_previous');
  assert.equal(result.attempts, MODELS.models.length);
  assert.equal(result.reasons.length, MODELS.models.length);
  assert.match(String(result.reasons[0]), /uncaught JS error/);
  assert.match(String(result.reasons[1]), /not self-contained/);
  assert.match(String(result.reasons[2]), /could not extract bundle/);
});

// The kinds are what the next day's prompt keys its guidance off, so they
// have to name the failure that actually happened.
test('each failed attempt is tagged with the kind of failure it was', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([
      loadFixture('badJsError'),
      loadFixture('badFetchAttempt'),
      loadFixture('badMalformedBlocks'),
    ]),
  });

  assert.equal(result.status, 'failed_kept_previous');
  assert.deepEqual(result.kinds, ['smoke-js-error', 'smoke-network', 'extract']);
});

test('a moderation rejection is tagged as one', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient(
      [loadFixture('goodMaze'), loadFixture('goodMaze'), loadFixture('goodMaze')],
      'FAIL: not allowed',
    ),
  });

  assert.equal(result.status, 'failed_kept_previous');
  assert.deepEqual(result.kinds, ['moderation', 'moderation', 'moderation']);
});

// A 429 on the moderation call used to be recorded as `moderation`, which
// reads as a content violation the game never committed.
test('an unreachable moderator is recorded as a call failure, not a content rejection', async () => {
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) throw new Error('rate limited');
      return { text: loadFixture('goodMaze'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });

  assert.equal(result.status, 'failed_kept_previous');
  // Neither a content rejection nor a generation that never returned: the
  // game was written and parsed, and only our moderator was down.
  assert.deepEqual(result.kinds, [
    'moderation-unreachable',
    'moderation-unreachable',
    'moderation-unreachable',
  ]);
});

test('a genre outside the catalogue is rejected before moderation', async () => {
  // The exact metadata that published a blank game on 2026-09-11: the output
  // format's example object, returned verbatim.
  const skeleton =
    '```json\n{"title": "...", "genre": "...", "theme": "...", "mechanics": ["...", "..."], ' +
    '"controls": [{"action": "...", "key": "..."}]}\n```\n\n' +
    '```html\n<!doctype html><html><body><canvas id="c"></canvas></body></html>\n```';
  let moderated = false;
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) {
        moderated = true;
        return { text: 'PASS', stop: 'complete', model };
      }
      return { text: skeleton, stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });

  assert.equal(result.status, 'failed_kept_previous');
  assert.deepEqual(result.kinds, ['unknown-genre', 'unknown-genre', 'unknown-genre']);
  assert.equal(moderated, false, 'a bundle this broken should not reach the moderator');
});

// The exact metadata that published a black-screen game on 2026-09-12: a
// valid genre (so the genre check cannot catch it) with every other field
// left as the output format's own placeholder, and an HTML block that shows
// static text but whose script never runs (so the smoke test's
// renderedSomething check cannot catch it either).
test('placeholder metadata is rejected even when the genre is valid and the page renders text', async () => {
  let moderated = false;
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) {
        moderated = true;
        return { text: 'PASS', stop: 'complete', model };
      }
      return { text: loadFixture('badPlaceholderMeta'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });

  assert.equal(result.status, 'failed_kept_previous');
  assert.deepEqual(result.kinds, ['placeholder-meta', 'placeholder-meta', 'placeholder-meta']);
  assert.equal(moderated, false, 'a bundle this broken should not reach the moderator');
});

test('retries after placeholder metadata and succeeds on the second attempt', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('badPlaceholderMeta'), loadFixture('goodMaze')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 2);
});

test('a stand-in moderator answers when the dedicated one cannot be reached', async () => {
  const asked: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (!isModerationRequest(messages))
        return { text: loadFixture('goodMaze'), stop: 'complete', model };
      asked.push(model);
      if (model === 'mod/model:free') throw new Error('rate limited');
      return { text: 'PASS', stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), modelsConfig: WIDE_MODELS, client });

  assert.equal(result.status, 'success');
  assert.equal(asked[0], 'mod/model:free');
  assert.ok(asked.length > 1, 'a stand-in should have been asked');
});

test('the stand-in moderators one attempt tries are bounded', async () => {
  // Each gets its own timeout, so an unbounded chain multiplied by the
  // rotation would overrun the workflow before it can record a failure.
  const perAttempt: string[][] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (!isModerationRequest(messages)) {
        perAttempt.push([]);
        return { text: loadFixture('goodMaze'), stop: 'complete', model };
      }
      perAttempt.at(-1)?.push(model);
      throw new Error('rate limited');
    },
  };
  // More unrequested models than the cap, so only the cap can stop the chain.
  const models: ModelsConfig = {
    ...WIDE_MODELS,
    models: [
      ...WIDE_MODELS.models,
      { id: 'f/model:free', active: true, provider: 'openrouter' },
      { id: 'g/model:free', active: true, provider: 'openrouter' },
    ],
  };

  await generateDailyGame({ ...baseParams(), modelsConfig: models, client });

  for (const models of perAttempt) {
    assert.equal(models.length, MAX_MODERATION_FALLBACKS + 1);
    assert.equal(new Set(models).size, models.length, 'no moderator is asked twice');
  }
});

test('an unreachable moderator does not tell the next attempt it broke the content rules', async () => {
  const prompts: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) throw new Error('rate limited');
      prompts.push(messages.at(-1)?.content ?? '');
      return { text: loadFixture('goodMaze'), stop: 'complete', model };
    },
  };

  await generateDailyGame({ ...baseParams(), client });

  assert.equal(prompts.length, MODELS.models.length);
  assert.doesNotMatch(String(prompts[1]), /violated the content rules/);
});

// The one failure no retry and no other model can fix, so the site says so
// rather than counting down to a game that is not coming.
test('a run whose every attempt is refused for capacity is marked quota exhausted', async () => {
  const client: OpenRouterClient = {
    async complete() {
      throw new OpenRouterHttpError(429, 'rate limited');
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });

  assert.equal(result.status, 'failed_kept_previous');
  assert.equal(result.quotaExhausted, true);
});

test('a run that fails for mixed reasons is not marked quota exhausted, but is quota affected', async () => {
  let calls = 0;
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete', model };
      calls += 1;
      if (calls === 1) return { text: loadFixture('badJsError'), stop: 'complete', model };
      throw new OpenRouterHttpError(429, 'rate limited');
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });

  assert.equal(result.status, 'failed_kept_previous');
  assert.equal(result.quotaExhausted, false);
  assert.equal(result.quotaAffected, true);
});

test('a successful run is quota affected when an earlier attempt was refused for capacity', async () => {
  let calls = 0;
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete', model };
      calls += 1;
      if (calls === 1) throw new OpenRouterHttpError(429, 'rate limited');
      return { text: loadFixture('goodMaze'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });

  assert.equal(result.status, 'success');
  if (result.status === 'success') {
    assert.deepEqual(result.kinds, ['generation-call']);
    assert.deepEqual(result.attemptModels, ['a/model:free']);
    assert.equal(result.quotaAffected, true);
  }
});

// The winning attempt's own moderation call can be the one that hit
// capacity — the dedicated moderator refuses, a fallback passes it, and the
// game still publishes. That is not the same as a prior attempt failing, so
// kinds/attemptModels stay empty, but quotaAffected must still be true.
test('a successful run is quota affected when its own moderation call needed a fallback for capacity', async () => {
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) {
        if (model === 'mod/model:free') throw new OpenRouterHttpError(429, 'rate limited');
        return { text: 'PASS', stop: 'complete', model };
      }
      return { text: loadFixture('goodMaze'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), modelsConfig: WIDE_MODELS, client });

  assert.equal(result.status, 'success');
  if (result.status === 'success') {
    assert.equal(result.attempts, 1);
    assert.deepEqual(result.kinds, []);
    assert.deepEqual(result.attemptModels, []);
    assert.equal(result.quotaAffected, true);
  }
});

test('a moderator refused for capacity marks the attempt quota affected, without exhausting the quota', async () => {
  let attempt = 0;
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) {
        // Only the middle attempt's moderator (and its fallbacks) is out of capacity.
        if (attempt === 2) throw new OpenRouterHttpError(429, 'rate limited');
        return { text: 'PASS', stop: 'complete', model };
      }
      attempt += 1;
      // Passes moderation but fails the smoke test — a non-quota failure for
      // the attempts that are not the middle one.
      return { text: loadFixture('badJsError'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });

  assert.equal(result.status, 'failed_kept_previous');
  assert.equal(result.quotaExhausted, false);
  assert.equal(result.quotaAffected, true);
});

// The bug this guards: quota used to be the same chain-accumulated flag as
// quotaAffected, so every attempt here — dedicated moderator refused for
// capacity, fallback rejects on content — would have counted as a quota
// failure and wrongly reported the run as quota exhausted. `quota` must stay
// precise to the decisive call so an ordinary content rejection is never
// mistaken for the account running out of capacity.
test('every attempt hitting capacity mid-chain but rejected on content is not quota exhausted', async () => {
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) {
        if (model === 'mod/model:free') throw new OpenRouterHttpError(429, 'rate limited');
        return { text: 'FAIL: depicts a banned character', stop: 'complete', model };
      }
      return { text: loadFixture('goodMaze'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), modelsConfig: WIDE_MODELS, client });

  assert.equal(result.status, 'failed_kept_previous');
  assert.equal(result.quotaExhausted, false);
  assert.equal(result.quotaAffected, true);
  if (result.status === 'failed_kept_previous') {
    assert.ok(result.kinds.every((kind) => kind === 'moderation'));
  }
});

test('a server fault is not mistaken for an exhausted quota', async () => {
  const client: OpenRouterClient = {
    async complete() {
      throw new OpenRouterHttpError(500, 'upstream exploded');
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });

  assert.equal(result.status, 'failed_kept_previous');
  assert.equal(result.quotaExhausted, false);
});

test('a successful run reports whether the game drew anything', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('goodMaze')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.canvasDrawn, true);
});

test('a guardrail-violating bundle is rejected even when it runs fine', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('badGuardrailWord'), loadFixture('goodMaze')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 2);
});

test('tries every active model once before giving up', async () => {
  const modelsSeen: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete', model };
      modelsSeen.push(model);
      return { text: loadFixture('badJsError'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({
    ...baseParams(),
    modelsConfig: WIDE_MODELS,
    client,
  });
  assert.equal(result.status, 'failed_kept_previous');
  assert.equal(result.attempts, 5);
  assert.deepEqual(modelsSeen, [
    'a/model:free',
    'b/model:free',
    'c/model:free',
    'd/model:free',
    'e/model:free',
  ]);
});

// The load-bearing detail: attemptModels[i] must be the model that MADE
// attempt i, not the one rotated in for the next attempt. Comparing against
// an independent record of which model answered each call is what would
// catch attemptModels.push(model) landing on the wrong side of the
// model-rotation line — a mismatch neither the parallel-length check in
// recordFailure nor the validator can see, since both leave the length
// alone.
test('attemptModels records which model made each attempt, not the one rotated in next', async () => {
  const modelsSeen: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete', model };
      modelsSeen.push(model);
      return { text: loadFixture('badJsError'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({
    ...baseParams(),
    modelsConfig: WIDE_MODELS,
    client,
  });

  assert.equal(result.status, 'failed_kept_previous');
  assert.deepEqual(result.attemptModels, modelsSeen);
});

test('a forced model still gives up after FORCED_MODEL_ATTEMPTS, however many models are active', async () => {
  const modelsSeen: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete', model };
      modelsSeen.push(model);
      return { text: loadFixture('badJsError'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({
    ...baseParams(),
    modelsConfig: WIDE_MODELS,
    client,
    forceModel: 'forced/model:free',
  });
  assert.equal(result.status, 'failed_kept_previous');
  assert.equal(result.attempts, FORCED_MODEL_ATTEMPTS);
  assert.equal(modelsSeen.length, FORCED_MODEL_ATTEMPTS);
});

test('forceModel pins every attempt to one model', async () => {
  const modelsSeen: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete', model };
      modelsSeen.push(model);
      return { text: loadFixture('badJsError'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({
    ...baseParams(),
    client,
    forceModel: 'forced/model:free',
  });
  assert.equal(result.status, 'failed_kept_previous');
  assert.deepEqual(modelsSeen, ['forced/model:free', 'forced/model:free', 'forced/model:free']);
});

test('a failing generation call is retried rather than crashing the run', async () => {
  let calls = 0;
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete', model };
      calls += 1;
      if (calls === 1) throw new Error('rate limited');
      return { text: loadFixture('goodMaze'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });
  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 2);
});

test('the previous failure is fed back into the next prompt', async () => {
  const prompts: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete', model };
      prompts.push(messages.at(-1)?.content ?? '');
      const fixture = prompts.length === 1 ? loadFixture('badJsError') : loadFixture('goodMaze');
      return { text: fixture, stop: 'complete', model };
    },
  };

  await generateDailyGame({ ...baseParams(), client });
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(String(prompts[0]), /previous attempt failed/);
  assert.match(String(prompts[1]), /previous attempt failed/);
  assert.match(String(prompts[1]), /thisFunctionDoesNotExist/);
});

// The only reliable way to offer "the same prompt" to a BYOK visitor is to
// snapshot the winning attempt's exact string — its inputs (history digest,
// remix selection) are not reconstructable after the fact.
test('a successful run returns the exact prompt sent on the winning attempt', async () => {
  const sentPrompts: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete', model };
      sentPrompts.push(messages.at(-1)?.content ?? '');
      return { text: loadFixture('goodMaze'), stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });
  assert.equal(result.status, 'success');
  assert.equal(sentPrompts.length, 1);
  assert.equal(result.prompt, sentPrompts[0]);
});

test('the mock client from fixtures drives a successful run end to end', async () => {
  // Uses the same mock the local dry run uses: fixtures for generation,
  // an automatic verdict for the moderation call.
  const client = createMockOpenRouterClient({ fixtureSequence: [loadFixture('goodMaze')] });
  const result = await generateDailyGame({ ...baseParams(), client });
  assert.equal(result.status, 'success');
});

test('the mock client can simulate a moderation rejection', async () => {
  const client = createMockOpenRouterClient({
    fixtureSequence: [loadFixture('goodMaze'), loadFixture('goodPlatformer')],
    moderationVerdict: 'FAIL: not allowed',
  });
  const result = await generateDailyGame({ ...baseParams(), client });
  assert.equal(result.status, 'failed_kept_previous');
});

// The seam exists so a run can be silenced; several cases here drive the
// every-attempt-failed path, whose reasons would otherwise be printed into
// the test runner's own output.
test('verbose progress goes to the injected logger, not the console', async () => {
  const lines: string[] = [];

  await generateDailyGame({
    ...baseParams(),
    modelsConfig: MODELS,
    client: scriptedClient([loadFixture('goodMaze')]),
    verbose: true,
    log: (message) => lines.push(message),
  });

  assert.ok(
    lines.some((line) => line.includes('Running smoke test...')),
    `expected the run's progress on the injected logger, got ${JSON.stringify(lines)}`,
  );
});

test('a run that is not verbose logs nothing at all', async () => {
  const lines: string[] = [];

  await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('goodMaze')]),
    log: (message) => lines.push(message),
  });

  assert.deepEqual(lines, []);
});

/**
 * A client whose generation calls are served by `serve(request)` whatever
 * model they asked for, as OpenRouter does after a failover. Moderation is
 * approved by the model it asked for. Every generation request is pushed onto
 * `seen`.
 */
function failingOver(
  serve: (request: CompletionRequest) => string,
  texts: readonly string[],
  seen: CompletionRequest[],
): OpenRouterClient {
  return {
    async complete(request) {
      if (isModerationRequest(request.messages)) {
        return { text: 'PASS', stop: 'complete', model: request.model };
      }
      const text = texts[Math.min(seen.length, texts.length - 1)] ?? '';
      seen.push(request);
      return { text, stop: 'complete', model: serve(request) };
    },
  };
}

test('each generation request carries the next two rotation models as fallbacks', async () => {
  const seen: CompletionRequest[] = [];
  await generateDailyGame({
    ...baseParams(),
    modelsConfig: WIDE_MODELS,
    client: failingOver((request) => request.model, [loadFixture('goodMaze')], seen),
  });

  assert.equal(seen[0]?.model, 'a/model:free');
  assert.deepEqual(seen[0]?.fallbackModels, ['b/model:free', 'c/model:free']);
});

test('a forced model gets no fallbacks', async () => {
  const seen: CompletionRequest[] = [];
  await generateDailyGame({
    ...baseParams(),
    modelsConfig: WIDE_MODELS,
    forceModel: 'forced/model:free',
    client: failingOver((request) => request.model, [loadFixture('goodMaze')], seen),
  });

  assert.ok(seen.length > 0, 'the generation call should have been made');
  assert.deepEqual(seen[0]?.fallbackModels ?? [], []);
});

test('moderation requests carry no generation fallbacks', async () => {
  const moderationRequests: CompletionRequest[] = [];
  const client: OpenRouterClient = {
    async complete(request) {
      if (!isModerationRequest(request.messages)) {
        return { text: loadFixture('goodMaze'), stop: 'complete', model: request.model };
      }
      moderationRequests.push(request);
      return { text: 'PASS', stop: 'complete', model: request.model };
    },
  };
  await generateDailyGame({ ...baseParams(), client });

  assert.ok(moderationRequests.length > 0);
  for (const request of moderationRequests) assert.equal(request.fallbackModels, undefined);
});

test('a game served by a fallback is recorded under the fallback, and the primary as failed over', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: failingOver(() => 'b/model:free', [loadFixture('goodMaze')], []),
  });

  assert.equal(result.status, 'success');
  if (result.status === 'success') {
    assert.equal(result.model, 'b/model:free');
    assert.equal(result.attempts, 1);
    assert.deepEqual(result.kinds, ['generation-failover']);
    assert.deepEqual(result.attemptModels, ['a/model:free']);
    assert.equal(result.quotaAffected, false, 'a silent failover has an unknown cause');
  }
});

test('every model ahead of the one that served is recorded as failed over', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: failingOver(() => 'c/model:free', [loadFixture('goodMaze')], []),
  });

  assert.equal(result.status, 'success');
  if (result.status === 'success') {
    assert.equal(result.model, 'c/model:free');
    assert.deepEqual(result.kinds, ['generation-failover', 'generation-failover']);
    assert.deepEqual(result.attemptModels, ['a/model:free', 'b/model:free']);
  }
});

test('a failure after a failover is attributed to the model that served', async () => {
  const seen: CompletionRequest[] = [];
  const result = await generateDailyGame({
    ...baseParams(),
    client: failingOver(
      (request) => (seen.length === 1 ? 'b/model:free' : request.model),
      [loadFixture('badJsError'), loadFixture('goodMaze')],
      seen,
    ),
  });

  assert.equal(result.status, 'success');
  if (result.status === 'success') {
    assert.deepEqual(result.kinds, ['generation-failover', 'smoke-js-error']);
    assert.deepEqual(result.attemptModels, ['a/model:free', 'b/model:free']);
  }
});

// The next attempt's primary is the model after the one that served.
test('the rotation moves on from the model that served, not the one asked for', async () => {
  const seen: CompletionRequest[] = [];
  await generateDailyGame({
    ...baseParams(),
    client: failingOver(
      (request) => (seen.length === 1 ? 'b/model:free' : request.model),
      [loadFixture('badJsError'), loadFixture('goodMaze')],
      seen,
    ),
  });

  assert.equal(seen[1]?.model, 'c/model:free');
});

// Nothing judges its own work: the author is one of the requested models, and
// a served id that resolved to the primary can hide which one, so none of them
// moderates.
test('no model requested for the generation moderates the game', async () => {
  const asked: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (!isModerationRequest(messages)) {
        return { text: loadFixture('goodMaze'), stop: 'complete', model: 'a/model:free' };
      }
      asked.push(model);
      if (model === 'mod/model:free') throw new Error('rate limited');
      return { text: 'PASS', stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), modelsConfig: WIDE_MODELS, client });

  assert.equal(result.status, 'success');
  assert.ok(asked.length > 1, 'a stand-in should have been asked');
  for (const requested of ['a/model:free', 'b/model:free', 'c/model:free']) {
    assert.ok(!asked.includes(requested), `${requested} moderated a game it may have written`);
  }
});

// Every model in a two-model rotation is requested, so the stand-in is any
// model but the one that served.
test('a rotation too small to spare a requested model still has a stand-in moderator', async () => {
  const twoModels: ModelsConfig = { ...MODELS, models: MODELS.models.slice(0, 2) };
  const asked: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (!isModerationRequest(messages)) {
        return { text: loadFixture('goodMaze'), stop: 'complete', model: 'b/model:free' };
      }
      asked.push(model);
      if (model === 'mod/model:free') throw new Error('rate limited');
      return { text: 'PASS', stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), modelsConfig: twoModels, client });

  assert.equal(result.status, 'success');
  assert.deepEqual(asked, ['mod/model:free', 'a/model:free']);
});

// A four-model rotation spares one unrequested model, so a requested one that
// did not serve fills the second stand-in slot.
test('stand-in moderators fill the cap from requested models that did not serve', async () => {
  const fourModels: ModelsConfig = { ...WIDE_MODELS, models: WIDE_MODELS.models.slice(0, 5) };
  const asked: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (!isModerationRequest(messages)) {
        return { text: loadFixture('goodMaze'), stop: 'complete', model };
      }
      asked.push(model);
      if (model === 'mod/model:free' || model === 'd/model:free') throw new Error('rate limited');
      return { text: 'PASS', stop: 'complete', model };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), modelsConfig: fourModels, client });

  assert.equal(result.status, 'success');
  assert.deepEqual(asked, ['mod/model:free', 'd/model:free', 'b/model:free']);
});

/** A client whose generation calls all throw, recording each request. */
function alwaysThrowing(seen: CompletionRequest[]): OpenRouterClient {
  return {
    async complete(request) {
      if (isModerationRequest(request.messages)) {
        return { text: 'PASS', stop: 'complete', model: request.model };
      }
      seen.push(request);
      throw new Error('everything is down');
    },
  };
}

test('a call that throws is attributed to the primary with no failover records', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    modelsConfig: WIDE_MODELS,
    client: alwaysThrowing([]),
  });

  assert.equal(result.status, 'failed_kept_previous');
  assert.deepEqual(result.kinds, Array(5).fill('generation-call'));
  assert.equal(new Set(result.attemptModels).size, 5, 'each attempt charged to its own primary');
});

// A throw can come from the model that was streaming, so the fallbacks it
// never reached are still ahead in the rotation.
test('after a call that throws the next primary is the model after the primary', async () => {
  const seen: CompletionRequest[] = [];
  await generateDailyGame({
    ...baseParams(),
    modelsConfig: WIDE_MODELS,
    client: alwaysThrowing(seen),
  });

  assert.deepEqual(
    seen.slice(0, 2).map((request) => request.model),
    ['a/model:free', 'b/model:free'],
  );
});

test('failovers appear in kinds and models but not in the reasons, which stay one per attempt', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: failingOver(
      (request) => request.fallbackModels?.[0] ?? request.model,
      [loadFixture('badJsError')],
      [],
    ),
  });

  assert.equal(result.status, 'failed_kept_previous');
  if (result.status === 'failed_kept_previous') {
    assert.equal(result.kinds.length, 6);
    assert.equal(result.attemptModels.length, result.kinds.length);
    assert.equal(result.reasons.length, result.attempts);
    assert.deepEqual(result.kinds.slice(0, 2), ['generation-failover', 'smoke-js-error']);
  }
});

test('the log says which model served when it was not the one asked for', async () => {
  const lines: string[] = [];
  await generateDailyGame({
    ...baseParams(),
    client: failingOver(() => 'b/model:free', [loadFixture('goodMaze')], []),
    verbose: true,
    log: (message) => lines.push(message),
  });

  assert.ok(
    lines.some((line) => line.includes('served by b/model:free (fallback from a/model:free)')),
    JSON.stringify(lines),
  );
});
