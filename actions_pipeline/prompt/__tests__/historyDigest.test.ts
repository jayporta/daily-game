import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FailedEntry } from '#actions_pipeline/lib/historyStore.ts';
import { HISTORY, received } from '#actions_pipeline/prompt/__tests__/fixtures.ts';
import { digestHistory, recentlyUsedGenreIds } from '#actions_pipeline/prompt/historyDigest.ts';

test('digestHistory lists every recent day, newest first', () => {
  const digest = digestHistory(HISTORY);
  const lines = digest.split('\n');

  assert.equal(lines.length, 3);
  assert.match(String(lines[0]), /2026-08-28/);
  assert.match(String(lines[1]), /2026-08-27/);
  assert.match(String(lines[2]), /2026-08-26/);
});

// Genres are only ever chosen by a published game, so a failed day must not
// mark one as recently used.
test('recentlyUsedGenreIds still ignores failed days', () => {
  assert.deepEqual(recentlyUsedGenreIds(HISTORY), ['maze-adventure', 'puzzle']);
});

// A failover names no fault of the game, so the digest a model reads lists
// only the kinds that describe what was wrong with the attempts.
test('digestHistory leaves failover records out of a failed day', () => {
  const failed: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 2,
    failureReasons: [],
    failureKinds: ['generation-failover', 'smoke-js-error'],
  };

  const digest = digestHistory([failed]);

  assert.match(digest, /smoke-js-error/);
  assert.doesNotMatch(digest, /generation-failover/);
});

test('digestHistory respects its limit', () => {
  assert.equal(digestHistory(HISTORY, 1).split('\n').length, 1);
});

test('digestHistory explains the empty case rather than emitting nothing', () => {
  assert.match(digestHistory([]), /very first one/);
});

test('recentlyUsedGenreIds dedupes and ignores failed entries', () => {
  assert.deepEqual(recentlyUsedGenreIds(HISTORY), ['maze-adventure', 'puzzle']);
});

test('digestHistory reports how a game was received', () => {
  const digest = digestHistory([
    received('2026-08-29', { likes: 2, dislikes: 7, dislikeReasons: { 'goal-unclear': 7 } }),
  ]);

  assert.match(digest, /2 liked, 7 disliked/);
  assert.match(digest, /marked: goal-unclear/);
});

test('digestHistory flags a game that painted nothing', () => {
  assert.match(digestHistory([received('2026-08-29', { canvasDrawn: false })]), /drew nothing/);
});

test('digestHistory says nothing about reception for an unrated game', () => {
  assert.doesNotMatch(digestHistory([received('2026-08-29')]), /liked|marked|drew nothing/);
});

// Three broken runs in a row is the most useful thing the next attempt could
// know, and the digest used to filter failed days out entirely.
test('digestHistory shows failed days and what broke', () => {
  const digest = digestHistory([
    {
      date: '2026-08-29',
      status: 'failed_kept_previous',
      model: 'm',
      attempts: 3,
      failureReasons: [],
      failureKinds: ['smoke-js-error', 'moderation'],
    },
  ]);

  assert.match(digest, /FAILED after 3 attempts/);
  assert.match(digest, /smoke-js-error, moderation/);
});
