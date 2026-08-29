import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleSite } from './assemble-site.ts';

function scratchRepo(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-assemble-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'index.html'), '<html>app</html>', 'utf8');
  return dir;
}

function seedPublishedContent(root: string): void {
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ slug: 'x' }), 'utf8');
  const gameDir = join(root, 'games', 'archive', '2026-08-29-thing');
  mkdirSync(gameDir, { recursive: true });
  writeFileSync(join(gameDir, 'game.html'), '<html>game</html>', 'utf8');
}

test('assembles the build output with the published content', (t) => {
  const root = scratchRepo(t);
  seedPublishedContent(root);

  const result = assembleSite({ root });

  assert.equal(result.copiedManifest, true);
  assert.equal(result.copiedArchive, true);
  assert.ok(existsSync(join(root, 'dist', 'index.html')), 'build output is preserved');
  assert.ok(existsSync(join(root, 'dist', 'manifest.json')));
  assert.ok(existsSync(join(root, 'dist', 'games', 'archive', '2026-08-29-thing', 'game.html')));
});

test('always writes .nojekyll so Pages serves the output untouched', (t) => {
  const root = scratchRepo(t);
  assembleSite({ root });
  assert.ok(existsSync(join(root, 'dist', '.nojekyll')));
});

test('copies published bundles byte-for-byte', (t) => {
  const root = scratchRepo(t);
  seedPublishedContent(root);
  const original = readFileSync(join(root, 'games', 'archive', '2026-08-29-thing', 'game.html'));

  assembleSite({ root });

  const copied = readFileSync(join(root, 'dist', 'games', 'archive', '2026-08-29-thing', 'game.html'));
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
