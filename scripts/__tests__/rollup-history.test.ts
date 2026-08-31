import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveEntries,
  archiveMonth,
  summariseEntries,
  readArchivedEntries,
  rollUpHistory,
  shouldRollUp,
  splitAging,
} from '../rollup-history.ts';
import { createPaths } from '../lib/paths.ts';
import { EMPTY_SUMMARY } from '../lib/history-store.ts';
import { GENERATION_CONFIG } from '../lib/testFixtures.ts';
import type { HistoryGameEntry } from '../lib/history-store.ts';

const NOW = new Date('2026-08-30T12:00:00.000Z');

/** A published entry `daysAgo` days before the frozen clock. */
function published(daysAgo: number, over: Partial<HistoryGameEntry> = {}): HistoryGameEntry {
  const date = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return {
    date,
    status: 'published',
    model: 'a/model:free',
    slug: `${date}-game`,
    genre: 'puzzle',
    theme: 'glass beetles',
    mechanics: ['move'],
    title: 'A Game',
    ...over,
  };
}

function scratchRepo(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-rollup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'history'), { recursive: true });
  return dir;
}

test('shouldRollUp waits until the hot window passes the trigger', () => {
  const config = { rollupTriggerEntries: 3 };

  assert.equal(shouldRollUp([published(1), published(2), published(3)], config), false);
  assert.equal(shouldRollUp([published(1), published(2), published(3), published(4)], config), true);
});

test('splitAging keeps entries inside the window and ages out the rest', () => {
  const { keep, aging } = splitAging(
    [published(1), published(44), published(46), published(400)],
    { historyHotWindowDays: 45 },
    NOW,
  );

  assert.deepEqual(keep.map((e) => e.date), [published(1).date, published(44).date]);
  assert.deepEqual(aging.map((e) => e.date), [published(400).date, published(46).date]);
});

// Dropping a row we cannot read would lose it without archiving it.
test('splitAging keeps an entry whose date cannot be parsed', () => {
  const broken = { ...published(400), date: 'not-a-date' };

  const { keep, aging } = splitAging([broken], { historyHotWindowDays: 45 }, NOW);

  assert.equal(keep.length, 1);
  assert.equal(aging.length, 0);
});

test('archiveMonth buckets an entry by its calendar month', () => {
  assert.equal(archiveMonth(published(0, { date: '2026-07-04' })), '2026-07');
});

test('summariseEntries tallies genres', () => {
  const merged = summariseEntries([
    published(50, { genre: 'puzzle' }),
    published(51, { genre: 'puzzle' }),
    published(52, { genre: 'platformer' }),
  ]);

  assert.deepEqual(merged.genreCounts, { puzzle: 2, platformer: 1 });
});

test('summariseEntries counts every entry it is given', () => {
  const merged = summariseEntries(
    Array.from({ length: 11 }, (_, i) => published(50 + i, { genre: 'puzzle' })),
  );

  assert.equal(merged.genreCounts['puzzle'], 11);
});

// The archive is the source of truth, so the same set tallies the same way
// however many times a rollup runs over it. A previous version added to the
// existing summary and double-counted when a run repeated.
test('summariseEntries is idempotent over the same entries', () => {
  const entries = [published(50, { genre: 'puzzle' }), published(51, { genre: 'puzzle' })];

  const first = summariseEntries(entries);
  const second = summariseEntries(entries);

  assert.equal(first.genreCounts['puzzle'], 2);
  assert.deepEqual(second, first);
});

test('summariseEntries records the most recent date a genre was used', () => {
  const merged = summariseEntries([
    published(0, { date: '2026-05-01', genre: 'puzzle' }),
    published(0, { date: '2026-06-01', genre: 'puzzle' }),
  ]);

  assert.equal(merged.genreLastUsed['puzzle'], '2026-06-01');
});

test('summariseEntries ignores failed runs, which have no genre', () => {
  const failed: HistoryGameEntry = {
    date: '2026-05-01',
    status: 'failed_kept_previous',
    model: 'a/model:free',
  };

  const merged = summariseEntries([failed]);

  assert.deepEqual(merged.genreCounts, {});
});

test('summariseEntries ranks the leaderboard by popularity', () => {
  const merged = summariseEntries([
    published(50, { slug: 'a', popularityScore: 3 }),
    published(51, { slug: 'b', popularityScore: 9 }),
    published(52, { slug: 'c', popularityScore: 5 }),
  ]);

  assert.deepEqual(merged.popularityLeaderboard.map((entry) => entry.slug), ['b', 'c', 'a']);
});

test('summariseEntries leaves an unrated game off the leaderboard', () => {
  const merged = summariseEntries([published(50, { slug: 'unrated' })]);

  assert.deepEqual(merged.popularityLeaderboard, []);
});

// Every leaderboard entry goes into every generation prompt verbatim, so the
// list has to stay bounded however long the project runs.
test('summariseEntries caps the leaderboard', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    published(50 + i, { slug: `game-${i}`, popularityScore: i }),
  );

  const merged = summariseEntries(many);

  assert.equal(merged.popularityLeaderboard.length, 10);
  assert.equal(merged.popularityLeaderboard[0]?.popularityScore, 29);
});

test('summariseEntries returns tallies only, never the prose', () => {
  assert.equal('lessons' in summariseEntries([published(50)]), false);
});

test('archiveEntries writes one JSONL file per calendar month', (t) => {
  const root = scratchRepo(t);
  const paths = createPaths(root);

  const files = archiveEntries(
    [published(0, { date: '2026-06-30' }), published(0, { date: '2026-07-01' })],
    paths,
  );

  assert.deepEqual(files, ['2026-06.jsonl', '2026-07.jsonl']);
  assert.ok(existsSync(paths.historyArchiveFile('2026-06')));
});

test('archiveEntries writes one entry per line, parseable back', (t) => {
  const root = scratchRepo(t);
  const paths = createPaths(root);

  archiveEntries([published(0, { date: '2026-06-01' }), published(0, { date: '2026-06-02' })], paths);

  const lines = readFileSync(paths.historyArchiveFile('2026-06'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => JSON.parse(l).date), ['2026-06-01', '2026-06-02']);
});

// A re-run must not duplicate: the archive is append-only and never rewritten.
test('archiveEntries skips a date already archived', (t) => {
  const root = scratchRepo(t);
  const paths = createPaths(root);
  const entry = published(0, { date: '2026-06-01' });

  archiveEntries([entry], paths);
  const files = archiveEntries([entry], paths);

  assert.deepEqual(files, []);
  assert.equal(readFileSync(paths.historyArchiveFile('2026-06'), 'utf8').trim().split('\n').length, 1);
});

test('archiveEntries appends without destroying existing content', (t) => {
  const root = scratchRepo(t);
  const paths = createPaths(root);
  archiveEntries([published(0, { date: '2026-06-01' })], paths);

  archiveEntries([published(0, { date: '2026-06-02' })], paths);

  const text = readFileSync(paths.historyArchiveFile('2026-06'), 'utf8');
  assert.match(text, /2026-06-01/);
  assert.match(text, /2026-06-02/);
});

/** Everything rollUpHistory would otherwise read from disk. */
function rollupOptions(root: string) {
  return {
    root,
    now: NOW,
    generationConfig: { ...GENERATION_CONFIG, rollupTriggerEntries: 60, historyHotWindowDays: 45 },
  };
}

/** A scratch repo holding `count` entries, the oldest well past the window. */
function seedHistory(root: string, count: number): HistoryGameEntry[] {
  const entries = Array.from({ length: count }, (_, i) => published(count - i));
  writeFileSync(join(root, 'history', 'games.json'), `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  writeFileSync(join(root, 'history', 'summary.json'), `${JSON.stringify(EMPTY_SUMMARY, null, 2)}\n`, 'utf8');
  return entries;
}

test('rollUpHistory does nothing while the hot window is under the trigger', async (t) => {
  const root = scratchRepo(t);
  seedHistory(root, 3);

  const result = await rollUpHistory(rollupOptions(root));

  assert.equal(result.rolledUp, false);
  assert.equal(existsSync(join(root, 'history', 'archive')), false);
});

test('rollUpHistory archives the old entries and keeps the recent ones', async (t) => {
  const root = scratchRepo(t);
  seedHistory(root, 70);

  const result = await rollUpHistory(rollupOptions(root));

  assert.equal(result.rolledUp, true);
  assert.equal(result.archived + result.kept, 70);
  const kept = JSON.parse(readFileSync(join(root, 'history', 'games.json'), 'utf8'));
  assert.equal(kept.length, result.kept);
});

// Nothing may be lost: every archived entry has to be readable back.
test('rollUpHistory loses no entry between the hot window and the archive', async (t) => {
  const root = scratchRepo(t);
  const seeded = seedHistory(root, 70);

  await rollUpHistory(rollupOptions(root));

  const paths = createPaths(root);
  const kept: HistoryGameEntry[] = JSON.parse(readFileSync(paths.historyGames, 'utf8'));
  const archived = new Set<string>();
  for (const month of new Set(seeded.map(archiveMonth))) {
    const file = paths.historyArchiveFile(month);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
      archived.add(JSON.parse(line).date);
    }
  }

  for (const entry of seeded) {
    const present = archived.has(entry.date) || kept.some((k) => k.date === entry.date);
    assert.ok(present, `${entry.date} survived neither in the hot window nor the archive`);
  }
});

test('rollUpHistory folds the aged-out genres into the summary', async (t) => {
  const root = scratchRepo(t);
  seedHistory(root, 70);

  await rollUpHistory(rollupOptions(root));

  const summary = JSON.parse(readFileSync(join(root, 'history', 'summary.json'), 'utf8'));
  assert.ok(summary.genreCounts['puzzle'] > 0);
});

// reflect-lessons.ts owns the note. The rollup must carry it through
// untouched rather than clearing it while it rewrites the tallies.
test('rollUpHistory leaves the lessons note alone', async (t) => {
  const root = scratchRepo(t);
  seedHistory(root, 70);
  writeFileSync(
    join(root, 'history', 'summary.json'),
    `${JSON.stringify({ ...EMPTY_SUMMARY, lessons: 'previous wisdom' }, null, 2)}\n`,
    'utf8',
  );

  const result = await rollUpHistory(rollupOptions(root));

  assert.equal(result.rolledUp, true);
  const summary = JSON.parse(readFileSync(join(root, 'history', 'summary.json'), 'utf8'));
  assert.equal(summary.lessons, 'previous wisdom');
});

test('rollUpHistory writes nothing on a dry run', async (t) => {
  const root = scratchRepo(t);
  seedHistory(root, 70);
  const before = readFileSync(join(root, 'history', 'games.json'), 'utf8');

  const result = await rollUpHistory({ ...rollupOptions(root), dryRun: true });

  assert.equal(result.rolledUp, true);
  assert.ok(result.archived > 0);
  assert.equal(readFileSync(join(root, 'history', 'games.json'), 'utf8'), before);
  assert.equal(existsSync(join(root, 'history', 'archive')), false);
});

// Running twice must be safe: the second pass sees a bounded window.
test('rollUpHistory is idempotent', async (t) => {
  const root = scratchRepo(t);
  seedHistory(root, 70);
  const options = rollupOptions(root);

  const first = await rollUpHistory(options);
  const second = await rollUpHistory(options);

  assert.equal(first.rolledUp, true);
  assert.equal(second.rolledUp, false);
  assert.equal(second.kept, first.kept);
});

// The crash window the derivation exists to survive: the archive and summary
// are written, then the process dies before games.json is truncated. The next
// run sees the same hot window and must not count those genres twice.
test('a rollup interrupted before truncation does not double-count on re-run', async (t) => {
  const root = scratchRepo(t);
  seedHistory(root, 70);
  const options = rollupOptions(root);
  const gamesJson = join(root, 'history', 'games.json');
  const untruncated = readFileSync(gamesJson, 'utf8');

  await rollUpHistory(options);
  const afterFirst = JSON.parse(readFileSync(join(root, 'history', 'summary.json'), 'utf8'));

  // Put the un-truncated hot window back, as a crash between the two writes
  // would have left it.
  writeFileSync(gamesJson, untruncated, 'utf8');
  await rollUpHistory(options);
  const afterSecond = JSON.parse(readFileSync(join(root, 'history', 'summary.json'), 'utf8'));

  assert.deepEqual(afterSecond.genreCounts, afterFirst.genreCounts);
});

test('readArchivedEntries reads back everything the archive holds', (t) => {
  const root = scratchRepo(t);
  const paths = createPaths(root);
  archiveEntries([published(0, { date: '2026-06-01' }), published(0, { date: '2026-07-01' })], paths);

  const entries = readArchivedEntries(paths);

  assert.deepEqual(entries.map((entry) => entry.date), ['2026-06-01', '2026-07-01']);
});

test('readArchivedEntries skips a corrupt line rather than throwing', (t) => {
  const root = scratchRepo(t);
  const paths = createPaths(root);
  archiveEntries([published(0, { date: '2026-06-01' })], paths);
  const file = paths.historyArchiveFile('2026-06');
  writeFileSync(file, `${readFileSync(file, 'utf8')}not json\n`, 'utf8');

  const entries = readArchivedEntries(paths);

  assert.deepEqual(entries.map((entry) => entry.date), ['2026-06-01']);
});

// Valid JSON of the wrong shape is the case a `JSON.parse` cast misses:
// the line parses, so the try/catch above never fires, and the bad value
// reaches summariseEntries' `mechanics.join`.
test('readArchivedEntries skips a well-formed line whose fields are the wrong type', (t) => {
  const root = scratchRepo(t);
  const paths = createPaths(root);
  archiveEntries([published(0, { date: '2026-06-01' })], paths);
  const file = paths.historyArchiveFile('2026-06');
  const wrongShape = JSON.stringify({ ...published(0, { date: '2026-06-02' }), mechanics: 'move' });
  writeFileSync(file, `${readFileSync(file, 'utf8')}${wrongShape}\n`, 'utf8');

  const entries = readArchivedEntries(paths);

  assert.deepEqual(entries.map((entry) => entry.date), ['2026-06-01']);
});

// `popularityScore` is what carries the entry past summariseEntries' early
// `continue` and into `mechanics.join` — without it the bad line is skipped
// for an unrelated reason and this test could not fail.
test('a rollup survives an archive line whose fields are the wrong type', async (t) => {
  const root = scratchRepo(t);
  const paths = createPaths(root);
  archiveEntries([published(0, { date: '2026-06-01', popularityScore: 1 })], paths);
  const file = paths.historyArchiveFile('2026-06');
  const wrongShape = JSON.stringify({
    ...published(0, { date: '2026-06-02', popularityScore: 2 }),
    mechanics: 'move',
  });
  writeFileSync(file, `${readFileSync(file, 'utf8')}${wrongShape}\n`, 'utf8');
  seedHistory(root, 70);

  await assert.doesNotReject(() => rollUpHistory(rollupOptions(root)));
});

test('readArchivedEntries is empty before anything has been archived', (t) => {
  assert.deepEqual(readArchivedEntries(createPaths(scratchRepo(t))), []);
});

test('the summary a rollup writes is one readSummary accepts', async (t) => {
  const root = scratchRepo(t);
  seedHistory(root, 70);

  await rollUpHistory(rollupOptions(root));

  const { readSummary } = await import('../lib/history-store.ts');
  assert.doesNotThrow(() => readSummary(createPaths(root).historySummary));
});
