import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ATTEMPTS, generateDailyGame } from './call-openrouter.ts';
import { createSmokeTester, type SmokeTester } from './smoke-test.ts';
import { createMockOpenRouterClient } from './lib/openrouter-client.mock.ts';
import { loadFixture } from './lib/fixtures.ts';
import { loadGuardrails, loadGenresConfig } from './lib/config-store.ts';
import { isModerationRequest } from './moderate.ts';
import type { OpenRouterClient } from './lib/openrouter-client.ts';
import type { GenerationConfig, HistorySummary, ModelsConfig } from './lib/types.ts';

const GUARDRAILS = loadGuardrails();
const GENRES = loadGenresConfig();

const MODELS: ModelsConfig = {
  moderationModel: 'mod/model:free',
  models: [
    { id: 'a/model:free', active: true, provider: 'openrouter' },
    { id: 'b/model:free', active: true, provider: 'openrouter' },
  ],
};

const GENERATION: GenerationConfig = {
  historyHotWindowDays: 45,
  rollupTriggerEntries: 60,
  remixProbability: 0,
  remixLookbackDays: 90,
  retryTemperatures: [0.7, 0.9, 1.0],
  sentryDsn: null,
  cronSchedule: '0 13 * * *',
};

const SUMMARY: HistorySummary = {
  genreCounts: {},
  genreLastUsed: {},
  popularityLeaderboard: [],
  lessons: '',
};

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
      if (isModerationRequest(messages)) return moderationVerdict;
      const next = remaining.shift();
      if (next === undefined) throw new Error('no generation fixture left');
      return next;
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
  assert.match(result.reasons[0] as string, /uncaught JS error/);
  assert.match(result.reasons[1] as string, /not self-contained/);
  assert.match(result.reasons[2] as string, /could not extract bundle/);
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
      if (isModerationRequest(messages)) return 'PASS';
      modelsSeen.push(model);
      return modelsSeen.length === 1 ? loadFixture('bad-js-error') : loadFixture('good-maze');
    },
  };

  await generateDailyGame({ ...baseParams(), client });
  assert.deepEqual(modelsSeen, ['a/model:free', 'b/model:free']);
});

test('forceModel pins every attempt to one model', async () => {
  const modelsSeen: string[] = [];
  const client: OpenRouterClient = {
    async complete({ model, messages }) {
      if (isModerationRequest(messages)) return 'PASS';
      modelsSeen.push(model);
      return loadFixture('bad-js-error');
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
      if (isModerationRequest(messages)) return 'PASS';
      calls += 1;
      if (calls === 1) throw new Error('rate limited');
      return loadFixture('good-maze');
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
      if (isModerationRequest(messages)) return 'PASS';
      prompts.push(messages.at(-1)?.content ?? '');
      return prompts.length === 1 ? loadFixture('bad-js-error') : loadFixture('good-maze');
    },
  };

  await generateDailyGame({ ...baseParams(), client });
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0] as string, /previous attempt failed/);
  assert.match(prompts[1] as string, /previous attempt failed/);
  assert.match(prompts[1] as string, /thisFunctionDoesNotExist/);
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
