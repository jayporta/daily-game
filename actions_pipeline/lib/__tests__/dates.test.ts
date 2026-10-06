import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameDate, parseDailyCron, slotStart } from '#actions_pipeline/lib/dates.ts';

const DAILY_19 = '0 19 * * *';

test('parseDailyCron reads the hour and minute of a daily schedule', () => {
  assert.deepEqual(parseDailyCron('0 19 * * *'), { hour: 19, minute: 0 });
  assert.deepEqual(parseDailyCron('30 7 * * *'), { hour: 7, minute: 30 });
});

test('parseDailyCron returns null for any other shape', () => {
  assert.equal(parseDailyCron('0 19 * * 1'), null);
  assert.equal(parseDailyCron('* 19 * * *'), null);
  assert.equal(parseDailyCron('*/15 * * * *'), null);
  assert.equal(parseDailyCron('nope'), null);
  assert.equal(parseDailyCron(''), null);
});

test('parseDailyCron rejects fields outside their range', () => {
  assert.equal(parseDailyCron('0 25 * * *'), null);
  assert.equal(parseDailyCron('60 19 * * *'), null);
  assert.equal(parseDailyCron('-1 19 * * *'), null);
  assert.equal(parseDailyCron('0 1.5 * * *'), null);
});

test('gameDate is the day of the slot a run falls in', () => {
  assert.equal(gameDate(DAILY_19, new Date('2026-10-06T19:00:13Z')), '2026-10-06');
  assert.equal(gameDate(DAILY_19, new Date('2026-10-06T23:59:59Z')), '2026-10-06');
});

// The 2026-10-06 incident: a fallback deferred past midnight UTC published a
// game dated for the day before's slot as the next day's.
test('gameDate keeps a run after midnight UTC on the previous day', () => {
  assert.equal(gameDate(DAILY_19, new Date('2026-10-06T01:05:31Z')), '2026-10-05');
  assert.equal(gameDate(DAILY_19, new Date('2026-10-06T18:29:59Z')), '2026-10-05');
});

test('gameDate lets a run just ahead of the tick claim the new slot', () => {
  assert.equal(gameDate(DAILY_19, new Date('2026-10-06T18:54:59Z')), '2026-10-05');
  assert.equal(gameDate(DAILY_19, new Date('2026-10-06T18:55:00Z')), '2026-10-06');
  assert.equal(gameDate(DAILY_19, new Date('2026-10-06T18:59:50Z')), '2026-10-06');
});

test('gameDate crosses a month and year boundary backwards', () => {
  assert.equal(gameDate(DAILY_19, new Date('2027-01-01T03:00:00Z')), '2026-12-31');
});

test('gameDate falls back to the calendar date for a schedule that is not plain daily', () => {
  assert.equal(gameDate('0 19 * * 1', new Date('2026-10-06T01:05:31Z')), '2026-10-06');
  assert.equal(gameDate('nope', new Date('2026-10-06T01:05:31Z')), '2026-10-06');
});

test('slotStart is the tick the slot opened at, lead included', () => {
  assert.equal(
    slotStart(DAILY_19, new Date('2026-10-06T18:57:00Z'))?.toISOString(),
    '2026-10-06T19:00:00.000Z',
  );
  assert.equal(
    slotStart(DAILY_19, new Date('2026-10-06T01:05:31Z'))?.toISOString(),
    '2026-10-05T19:00:00.000Z',
  );
});

test('slotStart is null for a schedule that is not plain daily', () => {
  assert.equal(slotStart('0 19 * * 1', new Date('2026-10-06T01:05:31Z')), null);
});
