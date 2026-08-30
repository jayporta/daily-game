import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, formatGeneratedDate, msUntil } from './countdown.ts';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');

test('msUntil returns the remaining milliseconds', () => {
  assert.equal(msUntil('2026-08-29T13:00:00.000Z', NOW), 3_600_000);
});

test('msUntil clamps a past expiry to zero', () => {
  assert.equal(msUntil('2026-08-29T11:00:00.000Z', NOW), 0);
});

test('msUntil treats an unparseable date as expired', () => {
  assert.equal(msUntil('not-a-date', NOW), 0);
});

test('formatCountdown shows hours and minutes when over an hour remains', () => {
  assert.equal(formatCountdown(6 * 3_600_000 + 12 * 60_000), '6h 12m');
});

test('formatCountdown switches to minutes and seconds under an hour', () => {
  assert.equal(formatCountdown(12 * 60_000 + 4_000), '12m 4s');
});

test('formatCountdown shows only seconds in the last minute', () => {
  assert.equal(formatCountdown(9_000), '9s');
});

test('formatCountdown handles an elapsed countdown', () => {
  assert.equal(formatCountdown(0), 'any moment now');
  assert.equal(formatCountdown(-5_000), 'any moment now');
});

test('formatGeneratedDate renders a stable, UTC-based date', () => {
  assert.equal(formatGeneratedDate('2026-08-29T13:04:00.000Z'), '8/29/26');
});

test('formatGeneratedDate degrades gracefully on bad input', () => {
  assert.equal(formatGeneratedDate('nonsense'), 'unknown date');
});
