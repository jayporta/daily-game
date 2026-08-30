import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadReactionConfig, loadReactionConfigOrUnconfigured } from './config-store.ts';

function scratchFile(t: { after(fn: () => void): void }, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'reaction-config.json');
  writeFileSync(file, contents, 'utf8');
  return file;
}

const UNCONFIGURED = { endpointUrl: null, anonKey: null };

test('loadReactionConfig reads a valid config', (t) => {
  const file = scratchFile(t, JSON.stringify(UNCONFIGURED));

  assert.deepEqual(loadReactionConfig(file), UNCONFIGURED);
});

test('loadReactionConfig reports a malformed config to whoever asks for it', (t) => {
  const file = scratchFile(t, '{ not json');

  assert.throws(() => loadReactionConfig(file));
});

// The daily run must not die over a cosmetic feature: a bad reaction config
// costs the day its like counts, never its game.
test('loadReactionConfigOrUnconfigured degrades rather than throwing on unparseable JSON', (t) => {
  const file = scratchFile(t, '{ not json');

  assert.deepEqual(loadReactionConfigOrUnconfigured(file), UNCONFIGURED);
});

test('loadReactionConfigOrUnconfigured degrades on a config that fails validation', (t) => {
  const file = scratchFile(t, JSON.stringify({ endpointUrl: 'http://insecure.test', anonKey: null }));

  assert.deepEqual(loadReactionConfigOrUnconfigured(file), UNCONFIGURED);
});

test('loadReactionConfigOrUnconfigured degrades when the file is absent entirely', () => {
  assert.deepEqual(loadReactionConfigOrUnconfigured('/nonexistent/reaction-config.json'), UNCONFIGURED);
});

test('loadReactionConfigOrUnconfigured still returns a valid config unchanged', (t) => {
  const configured = { endpointUrl: 'https://proj.supabase.co/rest/v1/reactions', anonKey: 'k' };
  const file = scratchFile(t, JSON.stringify(configured));

  assert.deepEqual(loadReactionConfigOrUnconfigured(file), configured);
});
