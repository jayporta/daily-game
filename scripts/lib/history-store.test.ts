import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendEntry,
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
