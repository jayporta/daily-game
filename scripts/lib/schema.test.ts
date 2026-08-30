import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paths } from './paths.ts';
import {
  validateModelsConfig,
  validateReactionConfig,
  validateGenresConfig,
  validateGenerationConfig,
  validateHistoryGames,
  validateHistorySummary,
  validateCspAllowsEndpoint,
} from './schema.ts';

test('validateModelsConfig accepts a valid config', () => {
  const result = validateModelsConfig({
    moderationModel: 'mistralai/mistral-7b-instruct:free',
    models: [
      { id: 'a/model:free', active: true, provider: 'openrouter' },
      { id: 'b/model:free', active: false, provider: 'openrouter' },
    ],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateModelsConfig rejects missing moderationModel', () => {
  const result = validateModelsConfig({ models: [{ id: 'a', active: true, provider: 'openrouter' }] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('moderationModel')));
});

test('validateModelsConfig rejects when no model is active', () => {
  const result = validateModelsConfig({
    moderationModel: 'm',
    models: [{ id: 'a', active: false, provider: 'openrouter' }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('at least one entry with active: true')));
});

test('validateModelsConfig rejects wrong-typed active field', () => {
  const result = validateModelsConfig({
    moderationModel: 'm',
    models: [{ id: 'a', active: 'yes', provider: 'openrouter' }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('active')));
});

test('validateGenresConfig accepts a valid config', () => {
  const result = validateGenresConfig([{ id: 'maze', label: 'Maze', examples: ['ex1', 'ex2'] }]);
  assert.equal(result.valid, true);
});

test('validateGenresConfig rejects duplicate ids', () => {
  const result = validateGenresConfig([
    { id: 'maze', label: 'Maze', examples: ['ex1'] },
    { id: 'maze', label: 'Maze Again', examples: ['ex2'] },
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('duplicated')));
});

test('validateGenresConfig rejects empty examples array entries', () => {
  const result = validateGenresConfig([{ id: 'maze', label: 'Maze', examples: [] }]);
  assert.equal(result.valid, false);
});

test('validateGenerationConfig accepts a valid config', () => {
  const result = validateGenerationConfig({
    historyHotWindowDays: 45,
    rollupTriggerEntries: 60,
    remixProbability: 0.2,
    remixLookbackDays: 90,
    retryTemperatures: [0.7, 0.9, 1.0],
    sentryDsn: null,
    cronSchedule: '0 13 * * *',
  });
  assert.equal(result.valid, true);
});

test('validateGenerationConfig rejects negative historyHotWindowDays', () => {
  const result = validateGenerationConfig({
    historyHotWindowDays: -1,
    rollupTriggerEntries: 60,
    remixProbability: 0.2,
    remixLookbackDays: 90,
    retryTemperatures: [0.7],
    sentryDsn: null,
    cronSchedule: '0 13 * * *',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('historyHotWindowDays')));
});

test('validateGenerationConfig rejects out-of-range remixProbability', () => {
  const result = validateGenerationConfig({
    historyHotWindowDays: 45,
    rollupTriggerEntries: 60,
    remixProbability: 1.5,
    remixLookbackDays: 90,
    retryTemperatures: [0.7],
    sentryDsn: null,
    cronSchedule: '0 13 * * *',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('remixProbability')));
});

test('validateHistoryGames accepts an empty array', () => {
  assert.equal(validateHistoryGames([]).valid, true);
});

test('validateHistoryGames accepts a valid published entry', () => {
  const result = validateHistoryGames([
    { date: '2026-08-29', status: 'published', model: 'a/model:free', slug: '2026-08-29-thing', genre: 'maze-adventure' },
  ]);
  assert.equal(result.valid, true);
});

test('validateHistoryGames rejects a malformed date', () => {
  const result = validateHistoryGames([
    { date: '08/29/2026', status: 'published', model: 'a/model:free', slug: 'x', genre: 'maze-adventure' },
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('date')));
});

test('validateHistoryGames rejects an invalid status', () => {
  const result = validateHistoryGames([{ date: '2026-08-29', status: 'pending', model: 'a/model:free' }]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('status')));
});

test('validateHistoryGames requires slug/genre only when published', () => {
  const result = validateHistoryGames([{ date: '2026-08-29', status: 'failed_kept_previous', model: 'a/model:free' }]);
  assert.equal(result.valid, true);
});

test('validateReactionConfig accepts the unconfigured store this site ships with', () => {
  assert.deepEqual(validateReactionConfig({ endpointUrl: null, anonKey: null }), {
    valid: true,
    errors: [],
  });
});

test('validateReactionConfig accepts a store with a publishable key', () => {
  assert.equal(
    validateReactionConfig({
      endpointUrl: 'https://proj.supabase.co/rest/v1/reactions',
      anonKey: 'sb_publishable_AbC123',
    }).valid,
    true,
  );
});

test('validateReactionConfig accepts a legacy anon JWT', () => {
  const anonJwt = `header.${Buffer.from('{"role":"anon"}').toString('base64url')}.sig`;

  assert.equal(
    validateReactionConfig({ endpointUrl: 'https://proj.test/rest/v1/x', anonKey: anonJwt }).valid,
    true,
  );
});

// Supabase's newer secret keys are not JWTs, so a check that only decoded
// JWTs would wave one straight through into the page.
test('validateReactionConfig rejects a secret key', () => {
  const result = validateReactionConfig({
    endpointUrl: 'https://proj.test/rest/v1/x',
    anonKey: 'sb_secret_AbC123',
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /ships to every visitor/);
});

// An allowlist: an unfamiliar shape is refused rather than assumed harmless.
test('validateReactionConfig rejects a key of no recognised shape', () => {
  assert.equal(
    validateReactionConfig({ endpointUrl: 'https://proj.test/rest/v1/x', anonKey: 'k' }).valid,
    false,
  );
});

test('validateReactionConfig rejects a missing field', () => {
  assert.equal(validateReactionConfig({ endpointUrl: null }).valid, false);
});

test('validateReactionConfig rejects a non-https endpoint', () => {
  assert.equal(validateReactionConfig({ endpointUrl: 'http://proj.test', anonKey: null }).valid, false);
});

// The key that ships in the page is insert-only. The privileged one lives
// in an Actions secret and must never reach the repo.
test('validateReactionConfig rejects a service_role key', () => {
  const serviceRoleJwt = `header.${Buffer.from('{"role":"service_role"}').toString('base64url')}.sig`;

  const result = validateReactionConfig({ endpointUrl: null, anonKey: serviceRoleJwt });

  assert.equal(result.valid, false);
});

test('the reaction config this repo ships carries no privileged key', () => {
  const shipped: unknown = JSON.parse(readFileSync(paths.reactionConfig, 'utf8'));

  assert.equal(validateReactionConfig(shipped).valid, true);
});

test('validateHistorySummary accepts a summary with every field present', () => {
  const result = validateHistorySummary({
    genreCounts: { puzzle: 3 },
    genreLastUsed: { puzzle: '2026-08-27' },
    popularityLeaderboard: [
      { slug: '2026-08-01-tide-garden', theme: 'tide clocks', mechanicsSummary: 'grow', popularityScore: 41 },
    ],
    lessons: 'Canvas resize handlers often forget to rescale entities.',
  });

  assert.deepEqual(result, { valid: true, errors: [] });
});

// An early run writes only what it knows; readSummary fills the rest in.
test('validateHistorySummary accepts a partial summary', () => {
  assert.equal(validateHistorySummary({ lessons: 'only lessons' }).valid, true);
  assert.equal(validateHistorySummary({}).valid, true);
});

// selectRemixSuggestion calls .filter on this, so a non-array crashes the run.
test('validateHistorySummary rejects a leaderboard that is not an array', () => {
  const result = validateHistorySummary({ popularityLeaderboard: 'oops' });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('popularityLeaderboard')));
});

test('validateHistorySummary rejects a leaderboard entry missing its slug', () => {
  const result = validateHistorySummary({
    popularityLeaderboard: [{ theme: 't', mechanicsSummary: 'm', popularityScore: 1 }],
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('[0].slug')));
});

test('validateHistorySummary rejects a non-numeric popularity score', () => {
  const result = validateHistorySummary({
    popularityLeaderboard: [{ slug: '2026-08-01-x', theme: 't', mechanicsSummary: 'm', popularityScore: 'high' }],
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('popularityScore')));
});

test('validateHistorySummary rejects lessons that are not a string', () => {
  assert.equal(validateHistorySummary({ lessons: ['a', 'b'] }).valid, false);
});

test('validateHistorySummary rejects genre counts that are not numbers', () => {
  assert.equal(validateHistorySummary({ genreCounts: { puzzle: 'three' } }).valid, false);
});

const CSP_SELF_ONLY = '<meta content="connect-src \'self\'; form-action \'none\'" />';
const CSP_WITH_STORE =
  '<meta content="connect-src \'self\' https://proj.supabase.co; form-action \'none\'" />';

test('validateCspAllowsEndpoint passes when no store is configured', () => {
  assert.deepEqual(validateCspAllowsEndpoint(null, CSP_SELF_ONLY), { valid: true, errors: [] });
});

// The trap this exists for: a configured store the CSP does not permit means
// the browser blocks every reaction and sendReaction swallows the failure, so
// nothing anywhere reports it.
test('validateCspAllowsEndpoint rejects a store the CSP would block', () => {
  const result = validateCspAllowsEndpoint(
    'https://proj.supabase.co/rest/v1/reactions',
    CSP_SELF_ONLY,
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /https:\/\/proj\.supabase\.co/);
});

test('validateCspAllowsEndpoint passes once the origin is listed', () => {
  const result = validateCspAllowsEndpoint(
    'https://proj.supabase.co/rest/v1/reactions',
    CSP_WITH_STORE,
  );

  assert.equal(result.valid, true);
});

// A prefix match would accept an attacker-controlled lookalike origin.
test('validateCspAllowsEndpoint matches whole origins, not substrings', () => {
  const result = validateCspAllowsEndpoint(
    'https://proj.supabase.co.evil.test/rest/v1/reactions',
    CSP_WITH_STORE,
  );

  assert.equal(result.valid, false);
});

test('validateCspAllowsEndpoint rejects an endpoint that is not a URL', () => {
  assert.equal(validateCspAllowsEndpoint('not a url', CSP_WITH_STORE).valid, false);
});

test('validateCspAllowsEndpoint reports a page with no connect-src at all', () => {
  const result = validateCspAllowsEndpoint('https://proj.supabase.co/x', '<meta content="" />');

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /no connect-src/);
});
