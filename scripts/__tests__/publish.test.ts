import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildManifest,
  buildSlug,
  computeExpiresAt,
  publish,
  recordFailure,
  restoreManifestFromArchive,
  slugify,
  withHeadMeta,
} from '../publish.ts';
import { GENERATION_CONFIG, GENRES, loadFixtureBundle } from '../lib/testFixtures.ts';
import { buildBundleCspMeta } from '../lib/errorReporting.ts';
import { readHotWindow } from '../lib/history-store.ts';
import { extractBundle } from '../../lib/extract-bundle-shared.ts';
import { isManifest } from '../../lib/manifest.ts';
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

const DSN = 'https://pub1ickey@o1.ingest.example/4567';
const withDsn = { ...GENERATION_CONFIG, sentryDsn: DSN };

function baseParams(root: string, meta: GeneratedMeta, html: string) {
  return {
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
  };
}

/** The published file with the injected policy line taken back out. */
function withoutCspMeta(published: string, dsn: string | null): string {
  return published.replace(`\n${buildBundleCspMeta(dsn)}`, '');
}

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
  assert.doesNotMatch(published, /ingest/);
  // The head policy is still added; with no DSN there is nowhere to reach.
  assert.match(published, /connect-src 'none'/);
  assert.equal(withoutCspMeta(published, null), html);
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
    generationConfig: withDsn,
    genres: GENRES,
    historyEntries: [],
    root,
  });

  const published = readFileSync(join(root, 'games', 'archive', result.slug, 'game.html'), 'utf8');
  assert.ok(withoutCspMeta(published, DSN).startsWith(html));
  assert.match(published, /o1\.ingest\.example\/api\/4567\/envelope\//);
});

test('publish pins a bundle to the Sentry origin and nothing else', (t) => {
  const root = scratchRoot(t);
  const { meta, html } = loadFixtureBundle('good-maze');

  const result = publish({ ...baseParams(root, meta, html), generationConfig: withDsn });

  const published = readFileSync(join(root, 'games', 'archive', result.slug, 'game.html'), 'utf8');
  assert.match(published, /content="connect-src https:\/\/o1\.ingest\.example"/);
  // The four BYOK provider origins index.html has to allow are inherited by
  // the frame; this policy is what takes them back off a generated game.
  assert.doesNotMatch(published, /connect-src[^"]*openai/);
});

// A meta CSP outside <head> is ignored, so where it lands is the whole point.
test('the bundle policy lands inside the document head', (t) => {
  const root = scratchRoot(t);
  const { meta, html } = loadFixtureBundle('good-maze');

  const result = publish({ ...baseParams(root, meta, html), generationConfig: withDsn });

  const published = readFileSync(join(root, 'games', 'archive', result.slug, 'game.html'), 'utf8');
  const head = published.slice(published.indexOf('<head'), published.indexOf('</head>'));
  assert.match(head, /Content-Security-Policy/);
  // Ahead of everything else in the head, so it covers the whole document.
  assert.ok(published.indexOf('Content-Security-Policy') < published.indexOf('<style'));
});

test('the doctype still opens the published document', (t) => {
  const root = scratchRoot(t);
  const { meta, html } = loadFixtureBundle('good-maze');

  const result = publish({ ...baseParams(root, meta, html), generationConfig: withDsn });

  const published = readFileSync(join(root, 'games', 'archive', result.slug, 'game.html'), 'utf8');
  assert.ok(published.startsWith('<!doctype html>'), 'a meta before the doctype means quirks mode');
});

test('withHeadMeta falls back to just after <html> when there is no head', () => {
  const injected = withHeadMeta('<!doctype html><html><body>hi</body></html>', '<meta id="m">');

  assert.equal(injected, '<!doctype html><html>\n<meta id="m"><body>hi</body></html>');
});

// The sandbox is the control; the policy is defence in depth. A bundle that
// has already cleared moderation and the smoke test must not be lost to one.
test('withHeadMeta leaves a document carrying neither tag alone', () => {
  assert.equal(withHeadMeta('<body>just a fragment</body>', '<meta id="m">'), '<body>just a fragment</body>');
});

test('publish still writes a bundle that has no head or html tag', (t) => {
  const root = scratchRoot(t);
  const { meta } = loadFixtureBundle('good-maze');

  const result = publish({
    ...baseParams(root, meta, '<body>just a fragment</body>'),
    generationConfig: withDsn,
  });

  const published = readFileSync(join(root, 'games', 'archive', result.slug, 'game.html'), 'utf8');
  assert.ok(published.startsWith('<body>just a fragment</body>'));
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

// The unrecoverable shape: extractBundle coerces a meta field the model
// omitted to '', publish commits that to history/games.json, and if the
// reader were stricter than the writer every later run would throw on a file
// nothing can repair. Whatever publish writes, readHotWindow must accept.
test('history readers accept an entry published from a sparse meta block', (t) => {
  const root = scratchRoot(t);
  const sparse = extractBundle(
    '```json\n{"genre":"puzzle"}\n```\n```html\n<!doctype html><html></html>\n```',
  );
  assert.equal(sparse.ok, true);
  if (!sparse.ok) return;

  publish({ ...baseParams(root, sparse.meta, sparse.html), generationConfig: withDsn });

  assert.doesNotThrow(() => readHotWindow(join(root, 'history', 'games.json')));
});

// --- restoring a manifest that has stopped pointing at a game ---
//
// A run that fails all three attempts keeps the previous manifest. When that
// manifest is the seed-state `null`, or names a bundle no longer on disk,
// "keeping" it leaves the site with nothing to show even though the archive
// still holds a playable game.

/** Publishes `count` days into `root`, oldest first, and returns the history. */
function publishDays(root: string, count: number): HistoryGameEntry[] {
  const { meta, html } = loadFixtureBundle('good-maze');
  let entries: HistoryGameEntry[] = [];
  for (let day = 0; day < count; day += 1) {
    entries = publish({
      ...baseParams(root, { ...meta, title: `Game ${day}` }, html),
      date: `2026-08-2${day}`,
      historyEntries: entries,
      root,
    }).historyEntries;
  }
  return entries;
}

const restoreParams = { generationConfig: GENERATION_CONFIG, genres: GENRES };

test('restoreManifestFromArchive leaves a manifest that is serving a game alone', (t) => {
  const root = scratchRoot(t);
  const entries = publishDays(root, 1);
  const before = readFileSync(join(root, 'manifest.json'), 'utf8');

  const result = restoreManifestFromArchive({ ...restoreParams, historyEntries: entries, root });

  assert.equal(result.status, 'intact');
  assert.equal(readFileSync(join(root, 'manifest.json'), 'utf8'), before);
});

test('restoreManifestFromArchive rebuilds the seed-state null manifest from the archive', (t) => {
  const root = scratchRoot(t);
  const entries = publishDays(root, 1);
  writeFileSync(join(root, 'manifest.json'), 'null', 'utf8');

  const result = restoreManifestFromArchive({ ...restoreParams, historyEntries: entries, root });

  assert.equal(result.status, 'restored');
  const written: unknown = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert.equal(isManifest(written), true);
  if (!isManifest(written)) return;
  assert.equal(written.slug, entries[0]?.slug);
  assert.equal(written.title, 'Game 0');
  assert.equal(written.model, 'a/model:free');
  assert.equal(written.genreLabel, 'Maze Adventure');
});

test('restoreManifestFromArchive falls back past a bundle that is no longer on disk', (t) => {
  const root = scratchRoot(t);
  const entries = publishDays(root, 2);
  const newest = entries[1]?.slug ?? '';
  rmSync(join(root, 'games', 'archive', newest), { recursive: true });

  const result = restoreManifestFromArchive({ ...restoreParams, historyEntries: entries, root });

  assert.equal(result.status, 'restored');
  assert.equal(result.status === 'restored' && result.manifest.slug, entries[0]?.slug);
});

test('restoreManifestFromArchive omits promptPath when the archive kept no prompt', (t) => {
  const root = scratchRoot(t);
  const entries = publishDays(root, 1);
  rmSync(join(root, 'games', 'archive', entries[0]?.slug ?? '', 'prompt.txt'));
  writeFileSync(join(root, 'manifest.json'), 'null', 'utf8');

  const result = restoreManifestFromArchive({ ...restoreParams, historyEntries: entries, root });

  assert.equal(result.status, 'restored');
  assert.equal(result.status === 'restored' && result.manifest.promptPath, undefined);
  assert.equal('promptPath' in JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')), false);
});

test('restoreManifestFromArchive skips an archive whose meta.json is unreadable', (t) => {
  const root = scratchRoot(t);
  const entries = publishDays(root, 2);
  writeFileSync(join(root, 'games', 'archive', entries[1]?.slug ?? '', 'meta.json'), '{oops', 'utf8');
  writeFileSync(join(root, 'manifest.json'), 'null', 'utf8');

  const result = restoreManifestFromArchive({ ...restoreParams, historyEntries: entries, root });

  assert.equal(result.status === 'restored' && result.manifest.slug, entries[0]?.slug);
});

// The card and the frame title both read from the manifest, so a restored
// day with no title would show as a blank heading over a working game.
test('restoreManifestFromArchive skips an archive whose metadata names no title', (t) => {
  const root = scratchRoot(t);
  const entries = publishDays(root, 2);
  const newest = join(root, 'games', 'archive', entries[1]?.slug ?? '', 'meta.json');
  writeFileSync(newest, JSON.stringify({ ...META, title: '' }), 'utf8');
  writeFileSync(join(root, 'manifest.json'), 'null', 'utf8');

  const result = restoreManifestFromArchive({ ...restoreParams, historyEntries: entries, root });

  assert.equal(result.status === 'restored' && result.manifest.slug, entries[0]?.slug);
});

// Only games/archive/ is copied into dist/, so a manifest naming anything
// outside it names a bundle the deployed site cannot serve, however real the
// file is locally. `..` segments normalise away, so the check cannot be a
// prefix test on the raw string.
test('restoreManifestFromArchive replaces a manifest naming a bundle outside the archive', (t) => {
  const root = scratchRoot(t);
  const entries = publishDays(root, 1);
  mkdirSync(join(root, 'decoy'), { recursive: true });
  writeFileSync(join(root, 'decoy', 'game.html'), '<html>not published</html>', 'utf8');
  const live: unknown = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({ ...(live as object), path: 'games/archive/../../decoy/game.html' }),
    'utf8',
  );

  const result = restoreManifestFromArchive({ ...restoreParams, historyEntries: entries, root });

  assert.equal(result.status, 'restored');
  assert.equal(result.status === 'restored' && result.manifest.slug, entries[0]?.slug);
});

test('restoreManifestFromArchive leaves the seed state alone when the archive is empty', (t) => {
  const root = scratchRoot(t);
  writeFileSync(join(root, 'manifest.json'), 'null', 'utf8');

  const result = restoreManifestFromArchive({ ...restoreParams, historyEntries: [], root });

  assert.equal(result.status, 'no-candidate');
  assert.equal(readFileSync(join(root, 'manifest.json'), 'utf8'), 'null');
});
