import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatCountdown,
  formatGeneratedDate,
  msUntil,
  msUntilLabelChanges,
} from '#src/features/game/countdown.ts';

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

test('waits a minute at a time while the label is showing whole minutes', () => {
  // 6h 12m 30s out: the label reads "6h 12m" until the 30s runs out.
  assert.equal(msUntilLabelChanges(6 * 3_600_000 + 12 * 60_000 + 30_000), 30_000);
});

test('waits a second at a time once the label is showing seconds', () => {
  assert.equal(msUntilLabelChanges(90_500), 500);
});

test('waits a full step when the remaining time sits exactly on a boundary', () => {
  assert.equal(msUntilLabelChanges(2 * 3_600_000), 60_000);
  assert.equal(msUntilLabelChanges(30_000), 1_000);
});

test('switches to seconds at the hour boundary formatCountdown uses', () => {
  // At exactly an hour the label is "1h 0m"; a millisecond under it is "59m 59s".
  assert.equal(msUntilLabelChanges(3_600_000), 60_000);
  assert.equal(msUntilLabelChanges(3_599_999), 999);
});

test('stops scheduling once the game is due for replacement', () => {
  assert.equal(msUntilLabelChanges(0), 0);
  assert.equal(msUntilLabelChanges(-5_000), 0);
});
