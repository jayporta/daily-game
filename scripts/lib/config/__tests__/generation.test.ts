import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateGenerationConfig } from '#scripts/lib/config/generation.ts';

test('validateGenerationConfig accepts a valid config', () => {
  const result = validateGenerationConfig({
    historyHotWindowDays: 45,
    rollupTriggerEntries: 60,
    remixProbability: 0.2,
    remixLookbackDays: 90,
    temperature: 0.7,
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
    temperature: 0.7,
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
    temperature: 0.7,
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
    temperature: 0.7,
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
    temperature: 0.7,
    sentryDsn: 'https://o42.ingest.example/4567',
    cronSchedule: '0 13 * * *',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('sentryDsn')));
});

// Above 2 the OpenAI-shaped API rejects the request outright, and the run
// would lose every attempt to the same argument error.
test('validateGenerationConfig rejects an out-of-range temperature', () => {
  const result = validateGenerationConfig({
    historyHotWindowDays: 45,
    rollupTriggerEntries: 60,
    remixProbability: 0.2,
    remixLookbackDays: 90,
    temperature: 2.5,
    sentryDsn: null,
    cronSchedule: '0 13 * * *',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('temperature')));
});
