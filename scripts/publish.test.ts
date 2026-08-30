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
} from './publish.ts';
import { loadFixtureBundle } from './lib/fixtures.ts';
import type { GenerationConfig, GenresConfig, HistoryGameEntry } from './lib/types.ts';
import type { GeneratedMeta } from '../lib/types.ts';

const GENERATION_CONFIG: GenerationConfig = {
  historyHotWindowDays: 45,
  rollupTriggerEntries: 60,
  remixProbability: 0.2,
  remixLookbackDays: 90,
  retryTemperatures: [0.7, 0.9, 1.0],
  sentryDsn: null,
  cronSchedule: '0 13 * * *',
};

const GENRES: GenresConfig = [
  { id: 'maze-adventure', label: 'Maze Adventure', examples: [] },
  { id: 'puzzle', label: 'Puzzle', examples: [] },
];

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
    generationConfig: GENERATION_CONFIG,
    genres: GENRES,
    historyEntries: [],
    generatedAt: '2026-08-29T13:04:00.000Z',
    root,
  });

  const gameDir = join(root, 'games', 'archive', result.slug);
  assert.ok(existsSync(join(gameDir, 'game.html')));
  assert.ok(existsSync(join(gameDir, 'meta.json')));

  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.slug, result.slug);
  assert.equal(manifest.model, 'a/model:free');

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
    historyEntries: [],
    root,
  });

  assert.equal(entries[0]?.status, 'failed_kept_previous');
  assert.equal(existsSync(join(root, 'manifest.json')), false, 'the live site must not be touched');
  assert.equal(existsSync(join(root, 'games', 'archive')), false);
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
