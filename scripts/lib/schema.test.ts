import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateModelsConfig,
  validateGenresConfig,
  validateGenerationConfig,
  validateHistoryGames,
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
