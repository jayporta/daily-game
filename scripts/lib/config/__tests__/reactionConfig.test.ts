import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  loadReactionConfig,
  loadReactionConfigOrUnconfigured,
  validateReactionConfig,
} from '#scripts/lib/config/reactionConfig.ts';
import { paths } from '#scripts/lib/paths.ts';

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
  const file = scratchFile(
    t,
    JSON.stringify({ endpointUrl: 'http://insecure.test', anonKey: null }),
  );

  assert.deepEqual(loadReactionConfigOrUnconfigured(file), UNCONFIGURED);
});

test('loadReactionConfigOrUnconfigured degrades when the file is absent entirely', () => {
  assert.deepEqual(
    loadReactionConfigOrUnconfigured('/nonexistent/reaction-config.json'),
    UNCONFIGURED,
  );
});

test('loadReactionConfigOrUnconfigured still returns a valid config unchanged', (t) => {
  const configured = {
    endpointUrl: 'https://proj.supabase.co/rest/v1/reactions',
    anonKey: 'sb_publishable_AbC123',
  };
  const file = scratchFile(t, JSON.stringify(configured));

  assert.deepEqual(loadReactionConfigOrUnconfigured(file), configured);
});

test('validateReactionConfig accepts the unconfigured store this site ships with', () => {
  const errors: string[] = [];
  const valid = validateReactionConfig({ endpointUrl: null, anonKey: null }, errors);
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('validateReactionConfig accepts a store with a publishable key', () => {
  const errors: string[] = [];
  assert.equal(
    validateReactionConfig(
      {
        endpointUrl: 'https://proj.supabase.co/rest/v1/reactions',
        anonKey: 'sb_publishable_AbC123',
      },
      errors,
    ),
    true,
  );
});

test('validateReactionConfig accepts a legacy anon JWT', () => {
  const anonJwt = `header.${Buffer.from('{"role":"anon"}').toString('base64url')}.sig`;

  const errors: string[] = [];
  assert.equal(
    validateReactionConfig(
      { endpointUrl: 'https://proj.test/rest/v1/x', anonKey: anonJwt },
      errors,
    ),
    true,
  );
});

// Supabase's newer secret keys are not JWTs, so a check that only decoded
// JWTs would wave one straight through into the page.
test('validateReactionConfig rejects a secret key', () => {
  const errors: string[] = [];
  const valid = validateReactionConfig(
    {
      endpointUrl: 'https://proj.test/rest/v1/x',
      anonKey: 'sb_secret_AbC123',
    },
    errors,
  );

  assert.equal(valid, false);
  assert.match(errors.join(' '), /ships to every visitor/);
});

// An allowlist: an unfamiliar shape is refused rather than assumed harmless.
test('validateReactionConfig rejects a key of no recognised shape', () => {
  const errors: string[] = [];
  assert.equal(
    validateReactionConfig({ endpointUrl: 'https://proj.test/rest/v1/x', anonKey: 'k' }, errors),
    false,
  );
});

test('validateReactionConfig rejects a missing field', () => {
  const errors: string[] = [];
  assert.equal(validateReactionConfig({ endpointUrl: null }, errors), false);
});

test('validateReactionConfig rejects a non-https endpoint', () => {
  const errors: string[] = [];
  assert.equal(
    validateReactionConfig({ endpointUrl: 'http://proj.test', anonKey: null }, errors),
    false,
  );
});

// The key that ships in the page is insert-only. The privileged one lives
// in an Actions secret and must never reach the repo.
test('validateReactionConfig rejects a service_role key', () => {
  const serviceRoleJwt = `header.${Buffer.from('{"role":"service_role"}').toString('base64url')}.sig`;

  const errors: string[] = [];
  const valid = validateReactionConfig({ endpointUrl: null, anonKey: serviceRoleJwt }, errors);

  assert.equal(valid, false);
});

test('the reaction config this repo ships carries no privileged key', () => {
  const shipped: unknown = JSON.parse(readFileSync(paths.reactionConfig, 'utf8'));

  const errors: string[] = [];
  assert.equal(validateReactionConfig(shipped, errors), true);
});
