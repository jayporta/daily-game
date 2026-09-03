import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assembleSite, missingPublishedFiles } from '#scripts/assemble-site.ts';
import { createPaths } from '#scripts/lib/paths.ts';
import { MANIFEST } from '#src/lib/testFixtures.ts';

function scratchRepo(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-assemble-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'index.html'), '<html>app</html>', 'utf8');
  return dir;
}

const SLUG = '2026-08-29-thing';

/** A manifest and the files it points at, as one published day. */
function seedPublishedContent(root: string, { withPrompt = true } = {}): void {
  const manifest = {
    ...MANIFEST,
    slug: SLUG,
    path: `games/archive/${SLUG}/game.html`,
    promptPath: `games/archive/${SLUG}/prompt.txt`,
  };
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  const gameDir = join(root, 'games', 'archive', SLUG);
  mkdirSync(gameDir, { recursive: true });
  writeFileSync(join(gameDir, 'game.html'), '<html>game</html>', 'utf8');
  if (withPrompt) writeFileSync(join(gameDir, 'prompt.txt'), 'the prompt', 'utf8');
}

test('assembles the build output with the published content', (t) => {
  const root = scratchRepo(t);
  seedPublishedContent(root);

  const result = assembleSite({ root });

  assert.equal(result.copiedManifest, true);
  assert.equal(result.copiedArchive, true);
  assert.ok(existsSync(join(root, 'dist', 'index.html')), 'build output is preserved');
  assert.ok(existsSync(join(root, 'dist', 'manifest.json')));
  assert.ok(existsSync(join(root, 'dist', 'games', 'archive', SLUG, 'game.html')));
});

test('always writes .nojekyll so Pages serves the output untouched', (t) => {
  const root = scratchRepo(t);
  assembleSite({ root });
  assert.ok(existsSync(join(root, 'dist', '.nojekyll')));
});

test('copies published bundles byte-for-byte', (t) => {
  const root = scratchRepo(t);
  seedPublishedContent(root);
  const original = readFileSync(join(root, 'games', 'archive', SLUG, 'game.html'));

  assembleSite({ root });

  const copied = readFileSync(join(root, 'dist', 'games', 'archive', SLUG, 'game.html'));
  assert.deepEqual(copied, original);
});

test('succeeds before any game has been published', (t) => {
  const root = scratchRepo(t);
  const result = assembleSite({ root });
  assert.equal(result.copiedManifest, false);
  assert.equal(result.copiedArchive, false);
  assert.ok(existsSync(join(root, 'dist', 'index.html')));
});

test('fails loudly when the build has not been run', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-assemble-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => assembleSite({ root: dir }), /run `vite build` first/);
});

// The failure this exists to stop: manifest.json committed without the
// bundle it names. Every other check stays green and the deployed site 404s
// on its only page.
test('refuses to assemble a site whose manifest names a missing bundle', (t) => {
  const root = scratchRepo(t);
  seedPublishedContent(root);
  rmSync(join(root, 'games', 'archive', SLUG, 'game.html'));

  assert.throws(() => assembleSite({ root }), /would 404/);
});

test('refuses to assemble when only the prompt is missing', (t) => {
  const root = scratchRepo(t);
  seedPublishedContent(root, { withPrompt: false });

  assert.throws(() => assembleSite({ root }), /prompt\.txt/);
});

// A manifest that names no prompt is a game archived before prompts were,
// not a half-written one — distinct from the case above, where the manifest
// declares a prompt.txt that is not there.
/** Repoints the seeded manifest's `path` at `urlPath`, leaving the rest. */
function repointManifest(root: string, urlPath: string): void {
  const parsed: unknown = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({ ...(parsed as object), path: urlPath }),
    'utf8',
  );
}

// Only games/archive/ is copied into dist/, so a bundle anywhere else is one
// the deployed site cannot serve however real the file is in the repo. The
// `..` segments normalise away when the path is resolved, so this cannot be
// caught by a prefix test on the raw string.
test('missingPublishedFiles reports a bundle that resolves outside the archive', (t) => {
  const root = scratchRepo(t);
  seedPublishedContent(root);
  mkdirSync(join(root, 'decoy'), { recursive: true });
  writeFileSync(join(root, 'decoy', 'game.html'), '<html>not published</html>', 'utf8');
  repointManifest(root, 'games/archive/../../decoy/game.html');

  assert.deepEqual(missingPublishedFiles(createPaths(root)), [
    'games/archive/../../decoy/game.html',
  ]);
});

test('assembleSite refuses a manifest naming a bundle outside the archive', (t) => {
  const root = scratchRepo(t);
  seedPublishedContent(root);
  mkdirSync(join(root, 'decoy'), { recursive: true });
  writeFileSync(join(root, 'decoy', 'game.html'), '<html>not published</html>', 'utf8');
  repointManifest(root, 'games/archive/../../decoy/game.html');

  assert.throws(() => assembleSite({ root }), /would 404/);
});

test('missingPublishedFiles accepts a manifest that declares no prompt', (t) => {
  const root = scratchRepo(t);
  seedPublishedContent(root, { withPrompt: false });
  const { promptPath: _omitted, ...withoutPrompt } = JSON.parse(
    readFileSync(join(root, 'manifest.json'), 'utf8'),
  ) as Record<string, unknown>;
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(withoutPrompt), 'utf8');

  assert.deepEqual(missingPublishedFiles(createPaths(root)), []);
});

test('missingPublishedFiles accepts the seed-state null manifest', (t) => {
  const root = scratchRepo(t);
  writeFileSync(join(root, 'manifest.json'), 'null', 'utf8');

  assert.deepEqual(missingPublishedFiles(createPaths(root)), []);
});

test('missingPublishedFiles accepts a repo with no manifest at all', (t) => {
  const root = scratchRepo(t);

  assert.deepEqual(missingPublishedFiles(createPaths(root)), []);
});
