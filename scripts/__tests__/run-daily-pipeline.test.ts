import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { runDailyPipeline } from '#scripts/call-openrouter.ts';
import { readHotWindow, writeGamesJson } from '#scripts/lib/history-store.ts';
import type { OpenRouterClient } from '#scripts/lib/openrouter-client.ts';
import { createPaths, REPO_ROOT } from '#scripts/lib/paths.ts';
import {
  GENERATION_CONFIG,
  GENRES,
  loadFixture,
  loadFixtureBundle,
  PUBLISHED_ENTRY,
  PUBLISHED_SLUG,
  scriptedClient,
} from '#scripts/lib/testFixtures.ts';
import { buildManifest } from '#scripts/publish.ts';
import { createSmokeTester, type SmokeTester } from '#scripts/smoke-test.ts';

// One browser for the file: every case supplies this rather than letting the
// pipeline create (and close) its own.
let smokeTester: SmokeTester;

before(async () => {
  smokeTester = await createSmokeTester();
});

after(async () => {
  await smokeTester?.close();
});

/**
 * A scratch repo holding a copy of the real config, and no history at all.
 *
 * `readHotWindow` treats a missing games.json as an empty history, so a run
 * against this starts from nothing and reconciles no previous day — which is
 * what keeps the reaction-store fetch out of most of these tests.
 */
function scratchRoot(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-pipeline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(REPO_ROOT, 'config'), join(dir, 'config'), { recursive: true });
  return dir;
}

test('a day that already published generates nothing', async (t) => {
  const root = scratchRoot(t);
  writeGamesJson(createPaths(root).historyGames, [PUBLISHED_ENTRY]);

  // A seeded published entry makes the run reconcile that day's reactions,
  // and `loadReactionConfigOrUnconfigured` reads the real committed config —
  // whose endpoint is live. Answer it here rather than over the network.
  t.mock.method(globalThis, 'fetch', async () => Response.json([]));

  let generationCalls = 0;
  const client: OpenRouterClient = {
    async complete() {
      generationCalls += 1;
      return { text: '', stop: 'complete' };
    },
  };

  const result = await runDailyPipeline({
    root,
    client,
    smokeTester,
    now: new Date(`${PUBLISHED_ENTRY.date}T12:00:00Z`),
  });

  assert.equal(result.status, 'already_published');
  assert.equal(result.status === 'already_published' && result.slug, PUBLISHED_SLUG);
  assert.equal(generationCalls, 0);
});

test('a dry run reports its result and writes nothing to disk', async (t) => {
  const root = scratchRoot(t);
  const paths = createPaths(root);

  const result = await runDailyPipeline({
    root,
    dryRun: true,
    client: scriptedClient([loadFixture('good-maze')]),
    smokeTester,
    now: new Date('2026-09-10T12:00:00Z'),
  });

  assert.equal(result.status, 'success');
  assert.equal(existsSync(paths.manifest), false);
  assert.equal(existsSync(paths.historyGames), false);
});

test('a successful run publishes the game and records it in history', async (t) => {
  const root = scratchRoot(t);
  const paths = createPaths(root);

  const result = await runDailyPipeline({
    root,
    client: scriptedClient([loadFixture('good-maze')]),
    smokeTester,
    now: new Date('2026-09-10T12:00:00Z'),
  });

  assert.equal(result.status, 'success');
  assert.ok(existsSync(paths.manifest));

  const entries = readHotWindow(paths.historyGames);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.date, '2026-09-10');
  assert.equal(entries[0]?.status, 'published');
});

test('a run that never gets a game records the failure and leaves the live manifest alone', async (t) => {
  const root = scratchRoot(t);
  const paths = createPaths(root);
  const { meta } = loadFixtureBundle('good-maze');

  // The manifest names a different archived game than history's newest
  // published entry does. That is what makes this observe the `intact`
  // branch: were the check to fail, the restore has a candidate to repoint
  // at, and the manifest would visibly change.
  const LIVE_SLUG = '2026-09-01-currently-serving';
  for (const slug of [LIVE_SLUG, PUBLISHED_SLUG]) {
    mkdirSync(paths.archiveGameDir(slug), { recursive: true });
    writeFileSync(join(paths.archiveGameDir(slug), 'game.html'), '<html><body></body></html>');
    // A restore candidate needs its metadata too, or it is skipped for
    // being unreadable rather than for the manifest being intact.
    writeFileSync(join(paths.archiveGameDir(slug), 'meta.json'), JSON.stringify(meta));
  }
  writeGamesJson(paths.historyGames, [PUBLISHED_ENTRY]);
  writeFileSync(
    paths.manifest,
    `${JSON.stringify(
      buildManifest({
        date: '2026-09-01',
        slug: LIVE_SLUG,
        meta,
        model: 'a/model:free',
        generatedAt: '2026-09-01T12:00:00.000Z',
        cronSchedule: GENERATION_CONFIG.cronSchedule,
        genres: GENRES,
        paths,
      }),
      null,
      2,
    )}\n`,
  );
  const manifestBefore = readFileSync(paths.manifest, 'utf8');

  // Reconciling the seeded published day would otherwise reach the real
  // reaction store; see the note on the first test.
  t.mock.method(globalThis, 'fetch', async () => Response.json([]));

  const result = await runDailyPipeline({
    root,
    // No fixtures left on the very first call, so every attempt fails.
    client: scriptedClient([]),
    smokeTester,
    now: new Date('2026-09-10T12:00:00Z'),
  });

  assert.equal(result.status, 'failed_kept_previous');
  assert.equal(readFileSync(paths.manifest, 'utf8'), manifestBefore);

  const entries = readHotWindow(paths.historyGames);
  assert.equal(entries.at(-1)?.date, '2026-09-10');
  assert.equal(entries.at(-1)?.status, 'failed_kept_previous');
});
