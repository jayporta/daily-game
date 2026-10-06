import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUMMARY } from '#actions_pipeline/prompt/__tests__/fixtures.ts';
import { selectRemixSuggestion } from '#actions_pipeline/prompt/remix.ts';

const NOW = new Date('2026-08-29T12:00:00Z');

test('selectRemixSuggestion returns null when the rng exceeds the probability', () => {
  const result = selectRemixSuggestion(SUMMARY, {
    remixProbability: 0.2,
    remixLookbackDays: 90,
    rng: () => 0.99,
    now: NOW,
  });
  assert.equal(result, null);
});

test('selectRemixSuggestion picks the highest score within the lookback window', () => {
  const result = selectRemixSuggestion(SUMMARY, {
    remixProbability: 0.2,
    remixLookbackDays: 90,
    rng: () => 0.0,
    now: NOW,
  });
  assert.equal(result?.slug, '2026-07-02-old-favourite');
});

test('selectRemixSuggestion excludes entries older than the lookback window', () => {
  const result = selectRemixSuggestion(SUMMARY, {
    remixProbability: 1,
    remixLookbackDays: 30,
    rng: () => 0.0,
    now: NOW,
  });
  assert.equal(result?.slug, '2026-08-01-tide-garden');
});

test('selectRemixSuggestion returns null when nothing is in range', () => {
  const result = selectRemixSuggestion(SUMMARY, {
    remixProbability: 1,
    remixLookbackDays: 1,
    rng: () => 0.0,
    now: NOW,
  });
  assert.equal(result, null);
});
