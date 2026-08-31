import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendEntry,
  patchEntry,
  lastPublishedEntry,
  readHotWindow,
  readSummary,
  renderGamesMd,
  validateHistoryGames,
  validateHistorySummary,
  writeGamesJson,
  writeGamesMd,
} from '../history-store.ts';
import { FAILED_ENTRY as FAILED, PUBLISHED_ENTRY as PUBLISHED } from '../testFixtures.ts';
import type { HistoryGameEntry } from '../history-store.ts';

function scratchDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-history-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('appendEntry keeps entries sorted oldest-first', () => {
  const result = appendEntry([FAILED], PUBLISHED);
  assert.deepEqual(result.map((e) => e.date), ['2026-08-28', '2026-08-29']);
});

test('appendEntry replaces an existing entry for the same date', () => {
  const rerun: HistoryGameEntry = { ...PUBLISHED, model: 'rerun/model:free' };
  const result = appendEntry([PUBLISHED, FAILED], rerun);
  assert.equal(result.length, 2);
  assert.equal(result.find((e) => e.date === '2026-08-28')?.model, 'rerun/model:free');
});

test('appendEntry does not mutate its input', () => {
  const original = [PUBLISHED];
  appendEntry(original, FAILED);
  assert.equal(original.length, 1);
});

test('lastPublishedEntry ignores failed runs', () => {
  assert.equal(lastPublishedEntry([PUBLISHED, FAILED])?.slug, '2026-08-28-beetle');
});

test('lastPublishedEntry returns undefined when nothing was ever published', () => {
  assert.equal(lastPublishedEntry([FAILED]), undefined);
});

test('readHotWindow returns an empty list for a missing file', () => {
  assert.deepEqual(readHotWindow('/nonexistent/games.json'), []);
});

test('readSummary returns the empty summary for a missing file', () => {
  const summary = readSummary('/nonexistent/summary.json');
  assert.deepEqual(summary.popularityLeaderboard, []);
  assert.equal(summary.lessons, '');
});

test('readSummary fills in missing keys from a partial file', (t) => {
  const dir = scratchDir(t);
  const file = join(dir, 'summary.json');
  writeFileSync(file, JSON.stringify({ lessons: 'only lessons' }), 'utf8');

  const summary = readSummary(file);
  assert.equal(summary.lessons, 'only lessons');
  assert.deepEqual(summary.genreCounts, {});
  assert.deepEqual(summary.popularityLeaderboard, []);
});

test('readSummary rejects a summary whose leaderboard is not a list', (t) => {
  const dir = scratchDir(t);
  const file = join(dir, 'summary.json');
  writeFileSync(file, JSON.stringify({ popularityLeaderboard: 'oops' }), 'utf8');

  assert.throws(() => readSummary(file), /invalid/);
});

test('readSummary rejects a leaderboard entry the prompt builder could not use', (t) => {
  const dir = scratchDir(t);
  const file = join(dir, 'summary.json');
  writeFileSync(file, JSON.stringify({ popularityLeaderboard: [{ slug: 42 }] }), 'utf8');

  assert.throws(() => readSummary(file), /invalid/);
});

test('writeGamesJson round-trips through readHotWindow', (t) => {
  const dir = scratchDir(t);
  const file = join(dir, 'nested', 'games.json');
  writeGamesJson(file, [PUBLISHED, FAILED]);
  assert.deepEqual(readHotWindow(file), [PUBLISHED, FAILED]);
});

test('readHotWindow rejects a structurally invalid history file', (t) => {
  const dir = scratchDir(t);
  const file = join(dir, 'games.json');
  writeGamesJson(file, [{ date: 'not-a-date', status: 'published', model: 'm' } as HistoryGameEntry]);
  assert.throws(() => readHotWindow(file), /invalid/);
});

test('renderGamesMd describes published and failed runs differently', () => {
  const md = renderGamesMd([PUBLISHED, FAILED]);
  assert.match(md, /## 2026-08-28 — Beetle Maze/);
  assert.match(md, /glass beetles/);
  assert.match(md, /## 2026-08-29 — generation failed, previous game kept/);
});

test('renderGamesMd lists newest first', () => {
  const md = renderGamesMd([PUBLISHED, FAILED]);
  assert.ok(md.indexOf('2026-08-29') < md.indexOf('2026-08-28'));
});

test('renderGamesMd names why a failed run gave up', () => {
  const md = renderGamesMd([{ ...FAILED, failureReasons: ['attempt 1: uncaught JS error'] }]);

  assert.match(md, /attempt 1: uncaught JS error/);
});

test('renderGamesMd handles an empty history', () => {
  assert.match(renderGamesMd([]), /_No games yet\._/);
});

test('writeGamesMd creates the file on disk', (t) => {
  const dir = scratchDir(t);
  const file = join(dir, 'games.md');
  writeGamesMd(file, [PUBLISHED]);
  assert.match(readFileSync(file, 'utf8'), /Beetle Maze/);
});

const RATED: HistoryGameEntry = {
  ...PUBLISHED,
  likes: 7,
  dislikes: 2,
  dislikeReasons: { broken: 1, 'goal-unclear': 2 },
};

test('patchEntry applies reaction counts to the matching slug', () => {
  const patched = patchEntry([FAILED, PUBLISHED], '2026-08-28-beetle', {
    likes: 7,
    dislikes: 2,
  });

  assert.deepEqual(patched[1], { ...PUBLISHED, likes: 7, dislikes: 2 });
});

test('patchEntry leaves every other entry untouched', () => {
  const patched = patchEntry([FAILED, PUBLISHED], '2026-08-28-beetle', { likes: 7 });

  assert.deepEqual(patched[0], FAILED);
});

// A slug that is not in the hot window has aged out, or was never ours.
test('patchEntry is a no-op for an unknown slug', () => {
  const entries = [FAILED, PUBLISHED];

  assert.deepEqual(patchEntry(entries, '2026-01-01-ghost', { likes: 7 }), entries);
});

test('patchEntry does not mutate its input', () => {
  const entries = [PUBLISHED];

  patchEntry(entries, '2026-08-28-beetle', { likes: 7 });

  assert.equal(entries[0]?.likes, undefined);
});

test('patchEntry overwrites counts from an earlier run rather than adding to them', () => {
  const patched = patchEntry([RATED], '2026-08-28-beetle', { likes: 9, dislikes: 3 });

  assert.equal(patched[0]?.likes, 9);
  assert.equal(patched[0]?.dislikes, 3);
});

test('renderGamesMd reports how a published game was received', () => {
  const markdown = renderGamesMd([RATED]);

  assert.match(markdown, /- likes: 7/);
  assert.match(markdown, /- dislikes: 2/);
});

test('renderGamesMd names the reasons a game was disliked for', () => {
  const markdown = renderGamesMd([RATED]);

  assert.match(markdown, /goal-unclear: 2/);
  assert.match(markdown, /broken: 1/);
});

test('renderGamesMd omits reaction lines for a game nobody rated', () => {
  const markdown = renderGamesMd([PUBLISHED]);

  assert.doesNotMatch(markdown, /- likes:/);
  assert.doesNotMatch(markdown, /- dislikes:/);
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

