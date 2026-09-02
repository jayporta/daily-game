import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ATTEMPTS, generateDailyGame } from '#scripts/call-openrouter.ts';
import { createSmokeTester, type SmokeTester } from '#scripts/smoke-test.ts';
import { createMockOpenRouterClient } from '#scripts/lib/openrouter-client.mock.ts';
import { GENERATION_CONFIG, loadFixture } from '#scripts/lib/testFixtures.ts';
import { EMPTY_SUMMARY } from '#scripts/lib/history-store.ts';
import { isModerationRequest } from '#scripts/moderate.ts';
import type { OpenRouterClient } from '#scripts/lib/openrouter-client.ts';
import type { HistorySummary } from '#scripts/lib/history-store.ts';
import type { GenerationConfig } from '#scripts/lib/config/generation.ts';
import { loadGenresConfig } from '#scripts/lib/config/genres.ts';
import { loadGuardrails } from '#scripts/lib/config/guardrails.ts';
import type { ModelsConfig } from '#scripts/lib/config/models.ts';

const GUARDRAILS = loadGuardrails();
const GENRES = loadGenresConfig();

const MODELS: ModelsConfig = {
  moderationModel: 'mod/model:free',
  models: [
    { id: 'a/model:free', active: true, provider: 'openrouter' },
    { id: 'b/model:free', active: true, provider: 'openrouter' },
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

/**
 * The generator and the moderator share one client, so a mock must answer
 * both. Generation fixtures are consumed in order; every other call is a
 * moderation call and gets the given verdict.
 */
function scriptedClient(generations: string[], moderationVerdict = 'PASS'): OpenRouterClient {
  const remaining = [...generations];
  return {
    async complete({ messages }) {
      if (isModerationRequest(messages)) return { text: moderationVerdict, stop: 'complete' };
      const next = remaining.shift();
      if (next === undefined) throw new Error('no generation fixture left');
      return { text: next, stop: 'complete' };
    },
  };
}

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
    client: scriptedClient([loadFixture('good-maze')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 1);
  assert.equal(result.meta.genre, 'maze-adventure');
  assert.equal(result.model, 'a/model:free');
});

test('retries after a JS-error bundle and succeeds on the second attempt', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('bad-js-error'), loadFixture('good-maze')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 2);
});

test('retries after an unparseable response', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('bad-malformed-blocks'), loadFixture('good-platformer')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 2);
});

// A truncated response loses its closing fence first, which extractBundle
// reports identically to a model that never wrote the block at all — the
// stop reason is what tells the two apart in the recorded failure.
test('an extraction failure caused by truncation names the output cap, not just the missing block', async () => {
  const client: OpenRouterClient = {
    async complete({ messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete' };
      return { text: loadFixture('bad-malformed-blocks'), stop: 'truncated' };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client, forceModel: 'a/model:free' });

  assert.equal(result.status, 'failed_kept_previous');
  for (const reason of result.reasons) {
    assert.match(reason, /could not extract bundle/);
    assert.match(reason, /response truncated at the output cap/);
  }
});

test('gives up after three failures and keeps the previous game', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([
      loadFixture('bad-js-error'),
      loadFixture('bad-fetch-attempt'),
      loadFixture('bad-malformed-blocks'),
    ]),
  });

  assert.equal(result.status, 'failed_kept_previous');
  assert.equal(result.attempts, MAX_ATTEMPTS);
  assert.equal(result.reasons.length, MAX_ATTEMPTS);
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
      loadFixture('bad-js-error'),
      loadFixture('bad-fetch-attempt'),
      loadFixture('bad-malformed-blocks'),
    ]),
  });

  assert.equal(result.status, 'failed_kept_previous');
  assert.deepEqual(result.kinds, ['smoke-js-error', 'smoke-network', 'extract']);
});

test('a moderation rejection is tagged as one', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient(
      [loadFixture('good-maze'), loadFixture('good-maze'), loadFixture('good-maze')],
      'FAIL: not allowed',
    ),
  });

  assert.equal(result.status, 'failed_kept_previous');
  assert.deepEqual(result.kinds, ['moderation', 'moderation', 'moderation']);
});

test('a successful run reports whether the game drew anything', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('good-maze')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.canvasDrawn, true);
});

test('a guardrail-violating bundle is rejected even when it runs fine', async () => {
  const result = await generateDailyGame({
    ...baseParams(),
    client: scriptedClient([loadFixture('bad-guardrail-word'), loadFixture('good-maze')]),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 2);
});

test('rotates to a different model after a failed attempt', async () => {
  const modelsSeen: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete' };
      modelsSeen.push(model);
      const fixture = modelsSeen.length === 1 ? loadFixture('bad-js-error') : loadFixture('good-maze');
      return { text: fixture, stop: 'complete' };
    },
  };

  await generateDailyGame({ ...baseParams(), client });
  assert.deepEqual(modelsSeen, ['a/model:free', 'b/model:free']);
});

test('forceModel pins every attempt to one model', async () => {
  const modelsSeen: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete' };
      modelsSeen.push(model);
      return { text: loadFixture('bad-js-error'), stop: 'complete' };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client, forceModel: 'forced/model:free' });
  assert.equal(result.status, 'failed_kept_previous');
  assert.deepEqual(modelsSeen, ['forced/model:free', 'forced/model:free', 'forced/model:free']);
});

test('a failing generation call is retried rather than crashing the run', async () => {
  let calls = 0;
  const client: OpenRouterClient = {
    async complete({ messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete' };
      calls += 1;
      if (calls === 1) throw new Error('rate limited');
      return { text: loadFixture('good-maze'), stop: 'complete' };
    },
  };

  const result = await generateDailyGame({ ...baseParams(), client });
  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 2);
});

test('the previous failure is fed back into the next prompt', async () => {
  const prompts: string[] = [];
  const client: OpenRouterClient = {
    async complete({ messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete' };
      prompts.push(messages.at(-1)?.content ?? '');
      const fixture = prompts.length === 1 ? loadFixture('bad-js-error') : loadFixture('good-maze');
      return { text: fixture, stop: 'complete' };
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
    async complete({ messages }) {
      if (isModerationRequest(messages)) return { text: 'PASS', stop: 'complete' };
      sentPrompts.push(messages.at(-1)?.content ?? '');
      return { text: loadFixture('good-maze'), stop: 'complete' };
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
  const client = createMockOpenRouterClient({ fixtureSequence: [loadFixture('good-maze')] });
  const result = await generateDailyGame({ ...baseParams(), client });
  assert.equal(result.status, 'success');
});

test('the mock client can simulate a moderation rejection', async () => {
  const client = createMockOpenRouterClient({
    fixtureSequence: [loadFixture('good-maze'), loadFixture('good-platformer')],
    moderationVerdict: 'FAIL: not allowed',
  });
  const result = await generateDailyGame({ ...baseParams(), client });
  assert.equal(result.status, 'failed_kept_previous');
});
