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
  writeGamesJson,
  writeGamesMd,
} from './history-store.ts';
import type { HistoryGameEntry } from './types.ts';

function scratchDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-history-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const PUBLISHED: HistoryGameEntry = {
  date: '2026-08-28',
  status: 'published',
  model: 'a/model:free',
  slug: '2026-08-28-beetle',
  genre: 'maze-adventure',
  theme: 'glass beetles',
  mechanics: ['move'],
  title: 'Beetle Maze',
};

const FAILED: HistoryGameEntry = {
  date: '2026-08-29',
  status: 'failed_kept_previous',
  model: 'b/model:free',
  attempts: 3,
};

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
