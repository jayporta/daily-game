import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGenerationConfig } from '#scripts/lib/config/generation.ts';

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

test('validateGenerationConfig accepts a well-formed sentry dsn', () => {
  const result = validateGenerationConfig({
    historyHotWindowDays: 45,
    rollupTriggerEntries: 60,
    remixProbability: 0.2,
    remixLookbackDays: 90,
    retryTemperatures: [0.7],
    sentryDsn: 'https://pub1ickey@o42.ingest.example/4567',
    cronSchedule: '0 13 * * *',
  });
  assert.equal(result.valid, true);
});

// An unparseable DSN makes the snippet empty, so games would ship with no
// error reporting and nothing would say so.
test('validateGenerationConfig rejects a malformed sentry dsn', () => {
  const result = validateGenerationConfig({
    historyHotWindowDays: 45,
    rollupTriggerEntries: 60,
    remixProbability: 0.2,
    remixLookbackDays: 90,
    retryTemperatures: [0.7],
    sentryDsn: 'https://o42.ingest.example/4567',
    cronSchedule: '0 13 * * *',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('sentryDsn')));
});
