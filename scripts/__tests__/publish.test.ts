import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildErrorReportingSnippet,
  buildManifest,
  buildSlug,
  computeExpiresAt,
  publish,
  recordFailure,
  slugify,
} from '../publish.ts';
import { GENERATION_CONFIG, GENRES, loadFixtureBundle } from '../lib/testFixtures.ts';
import type { HistoryGameEntry } from '../lib/history-store.ts';
import type { GeneratedMeta } from '../../lib/extract-bundle-shared.ts';

const META: GeneratedMeta = {
  title: 'Beetle Maze',
  genre: 'maze-adventure',
  theme: 'glass beetles',
  mechanics: ['move'],
  controls: [],
};

function scratchRoot(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-publish-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('slugify produces url-safe slugs', () => {
  assert.equal(slugify('Beetle of a Thousand Mirrors'), 'beetle-of-a-thousand-mirrors');
  assert.equal(slugify('  Weird!! Title??  '), 'weird-title');
  assert.equal(slugify('***'), 'untitled');
});

test('buildSlug prefixes the date', () => {
  assert.equal(buildSlug('2026-08-29', 'Glass Beetle'), '2026-08-29-glass-beetle');
});

test('computeExpiresAt returns the next daily cron occurrence', () => {
  // Generated before that day's 13:00 run → replaced by that same run.
  assert.equal(computeExpiresAt('0 13 * * *', '2026-08-29T09:00:00.000Z'), '2026-08-29T13:00:00.000Z');
});

test('computeExpiresAt rolls to the next day when the time has passed', () => {
  assert.equal(computeExpiresAt('0 13 * * *', '2026-08-29T14:00:00.000Z'), '2026-08-30T13:00:00.000Z');
});

test('computeExpiresAt falls back to +24h for an unsupported cron shape', () => {
  const result = computeExpiresAt('*/15 * * * 1', '2026-08-29T14:00:00.000Z');
  assert.equal(result, '2026-08-30T14:00:00.000Z');
});

test('computeExpiresAt rejects an invalid date', () => {
  assert.throws(() => computeExpiresAt('0 13 * * *', 'not-a-date'), /invalid date/);
});

test('buildErrorReportingSnippet is empty while Sentry is unprovisioned', () => {
  assert.equal(buildErrorReportingSnippet(null, '2026-08-29-x'), '');
});

test('buildErrorReportingSnippet embeds the dsn and slug once provisioned', () => {
  const snippet = buildErrorReportingSnippet('https://ingest.example/123', '2026-08-29-x');
  assert.match(snippet, /ingest\.example/);
  assert.match(snippet, /2026-08-29-x/);
  assert.match(snippet, /addEventListener\('error'/);
});

test('buildManifest records the url-facing path and computed expiry', () => {
  const { meta } = loadFixtureBundle('good-maze');
  const manifest = buildManifest({
    date: '2026-08-29',
    slug: '2026-08-29-beetle',
    meta,
    model: 'a/model:free',
    generatedAt: '2026-08-29T13:04:00.000Z',
    cronSchedule: '0 13 * * *',
    genres: GENRES,
  });
  assert.equal(manifest.path, 'games/archive/2026-08-29-beetle/game.html');
  assert.equal(manifest.promptPath, 'games/archive/2026-08-29-beetle/prompt.txt');
  assert.equal(manifest.title, meta.title);
  assert.equal(manifest.genre, 'maze-adventure');
  assert.equal(manifest.expiresAt, '2026-08-30T13:00:00.000Z');
});

test('publish writes the archive folder, manifest and history', (t) => {
  const root = scratchRoot(t);
  const { meta, html } = loadFixtureBundle('good-maze');

  const result = publish({
    date: '2026-08-29',
    meta,
    html,
    model: 'a/model:free',
    attempts: 1,
    prompt: 'the exact prompt sent to the model',
    generationConfig: GENERATION_CONFIG,
    genres: GENRES,
    historyEntries: [],
    generatedAt: '2026-08-29T13:04:00.000Z',
    root,
  });

  const gameDir = join(root, 'games', 'archive', result.slug);
  assert.ok(existsSync(join(gameDir, 'game.html')));
  assert.ok(existsSync(join(gameDir, 'meta.json')));
  assert.equal(
    readFileSync(join(gameDir, 'prompt.txt'), 'utf8'),
    'the exact prompt sent to the model',
  );

  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.slug, result.slug);
  assert.equal(manifest.model, 'a/model:free');
  assert.equal(manifest.promptPath, `games/archive/${result.slug}/prompt.txt`);

  const history = JSON.parse(readFileSync(join(root, 'history', 'games.json'), 'utf8'));
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'published');
  assert.equal(history[0].genre, 'maze-adventure');

  assert.match(readFileSync(join(root, 'history', 'games.md'), 'utf8'), /Beetle of a Thousand Mirrors/);
});

test('publish appends no Sentry snippet while the dsn is null', (t) => {
  const root = scratchRoot(t);
  const { meta, html } = loadFixtureBundle('good-maze');

  const result = publish({
    date: '2026-08-29',
    meta,
    html,
    model: 'a/model:free',
    attempts: 1,
    prompt: 'the exact prompt sent to the model',
    generationConfig: GENERATION_CONFIG,
    genres: GENRES,
    historyEntries: [],
    root,
  });

  const published = readFileSync(join(root, 'games', 'archive', result.slug, 'game.html'), 'utf8');
  assert.equal(published, html);
});

test('publish appends the snippet once a dsn is configured', (t) => {
  const root = scratchRoot(t);
  const { meta, html } = loadFixtureBundle('good-maze');

  const result = publish({
    date: '2026-08-29',
    meta,
    html,
    model: 'a/model:free',
    attempts: 1,
    prompt: 'the exact prompt sent to the model',
    generationConfig: { ...GENERATION_CONFIG, sentryDsn: 'https://ingest.example/123' },
    genres: GENRES,
    historyEntries: [],
    root,
  });

  const published = readFileSync(join(root, 'games', 'archive', result.slug, 'game.html'), 'utf8');
  assert.ok(published.startsWith(html));
  assert.match(published, /ingest\.example/);
});

test('publish preserves earlier history entries', (t) => {
  const root = scratchRoot(t);
  const { meta, html } = loadFixtureBundle('good-maze');
  const existing: HistoryGameEntry[] = [
    { date: '2026-08-28', status: 'published', model: 'old/model:free', slug: '2026-08-28-old', genre: 'puzzle' },
  ];

  publish({
    date: '2026-08-29',
    meta,
    html,
    model: 'a/model:free',
    attempts: 2,
    prompt: 'the exact prompt sent to the model',
    generationConfig: GENERATION_CONFIG,
    genres: GENRES,
    historyEntries: existing,
    root,
  });

  const history = JSON.parse(readFileSync(join(root, 'history', 'games.json'), 'utf8'));
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((e: HistoryGameEntry) => e.date), ['2026-08-28', '2026-08-29']);
});

test('recordFailure logs the failure and leaves the manifest untouched', (t) => {
  const root = scratchRoot(t);

  const entries = recordFailure({
    date: '2026-08-29',
    model: 'a/model:free',
    attempts: 3,
    reasons: [],
    kinds: [],
    historyEntries: [],
    root,
  });

  assert.equal(entries[0]?.status, 'failed_kept_previous');
  assert.equal(existsSync(join(root, 'manifest.json')), false, 'the live site must not be touched');
  assert.equal(existsSync(join(root, 'games', 'archive')), false);
});

// Without these stored, a failed day leaves only an attempt count and the
// rollup can never distil what actually went wrong.
test('recordFailure keeps the reason each attempt failed', (t) => {
  const root = scratchRoot(t);

  const entries = recordFailure({
    date: '2026-08-29',
    model: 'a/model:free',
    attempts: 3,
    reasons: ['attempt 1: uncaught JS error', 'attempt 2: moderation rejected'],
    kinds: ['smoke-js-error', 'moderation'],
    historyEntries: [],
    root,
  });

  assert.deepEqual(entries[0]?.failureReasons, [
    'attempt 1: uncaught JS error',
    'attempt 2: moderation rejected',
  ]);
});

// A smoke-test reason carries the game's own console output, which a
// misbehaving bundle can produce without limit, and it reaches the rollup
// prompt from here.
test('recordFailure bounds a runaway reason', (t) => {
  const root = scratchRoot(t);

  const entries = recordFailure({
    date: '2026-08-29',
    model: 'a/model:free',
    attempts: 3,
    reasons: ['x'.repeat(10_000)],
    kinds: ['smoke-js-error'],
    historyEntries: [],
    root,
  });

  assert.equal(entries[0]?.failureReasons?.[0]?.length, 300);
});

test('recordFailure writes the reasons to disk, not just the returned array', (t) => {
  const root = scratchRoot(t);

  recordFailure({
    date: '2026-08-29',
    model: 'a/model:free',
    attempts: 3,
    reasons: ['attempt 1: smoke test failed'],
    kinds: ['smoke-js-error'],
    historyEntries: [],
    root,
  });

  const history = JSON.parse(readFileSync(join(root, 'history', 'games.json'), 'utf8'));
  assert.deepEqual(history[0].failureReasons, ['attempt 1: smoke test failed']);
});

test('recordFailure stores the closed-vocabulary kinds beside the prose', (t) => {
  const root = scratchRoot(t);

  const entries = recordFailure({
    date: '2026-08-29',
    model: 'a/model:free',
    attempts: 2,
    reasons: ['attempt 1: smoke', 'attempt 2: moderation'],
    kinds: ['smoke-network', 'moderation'],
    historyEntries: [],
    root,
  });

  assert.deepEqual(entries[0]?.failureKinds, ['smoke-network', 'moderation']);
});

// A published game that painted nothing still passes the smoke test, but it
// is weak evidence of a working game and the prompt should hear about it.
test('publish records whether the game drew anything', (t) => {
  const root = scratchRoot(t);
  const { meta, html } = loadFixtureBundle('good-maze');

  publish({
    date: '2026-08-29',
    meta,
    html,
    model: 'a/model:free',
    attempts: 1,
    canvasDrawn: false,
    prompt: 'the exact prompt sent to the model',
    generationConfig: GENERATION_CONFIG,
    genres: GENRES,
    historyEntries: [],
    root,
  });

  const history = JSON.parse(readFileSync(join(root, 'history', 'games.json'), 'utf8'));
  assert.equal(history[0].canvasDrawn, false);
});

test('buildManifest shows the genre by its readable label', () => {
  const manifest = buildManifest({
    date: '2026-08-29',
    slug: '2026-08-29-beetle',
    meta: { ...META, genre: 'growth-sim' },
    genres: [{ id: 'growth-sim', label: 'Growth Simulation', examples: [] }],
    model: 'a/model:free',
    generatedAt: '2026-08-29T13:00:00.000Z',
    cronSchedule: '0 13 * * *',
  });

  assert.equal(manifest.genreLabel, 'Growth Simulation');
});

// Title-casing the id would produce "Growth Sim", so the label has to come
// from config rather than be derived.
test('buildManifest falls back to the raw genre id when it is unknown', () => {
  const manifest = buildManifest({
    date: '2026-08-29',
    slug: '2026-08-29-beetle',
    meta: { ...META, genre: 'not-a-real-genre' },
    genres: [{ id: 'puzzle', label: 'Puzzle', examples: [] }],
    model: 'a/model:free',
    generatedAt: '2026-08-29T13:00:00.000Z',
    cronSchedule: '0 13 * * *',
  });

  assert.equal(manifest.genreLabel, 'not-a-real-genre');
});

test('buildManifest carries the reported controls through to the front-end', () => {
  const manifest = buildManifest({
    date: '2026-08-29',
    slug: '2026-08-29-beetle',
    meta: { ...META, controls: [{ action: 'Steer', key: 'Arrow keys' }] },
    genres: [{ id: META.genre, label: 'Maze Adventure', examples: [] }],
    model: 'a/model:free',
    generatedAt: '2026-08-29T13:00:00.000Z',
    cronSchedule: '0 13 * * *',
  });

  assert.deepEqual(manifest.controls, [{ action: 'Steer', key: 'Arrow keys' }]);
});
