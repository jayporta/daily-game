import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAll } from './validate-config.ts';
import { createPaths, REPO_ROOT } from './lib/paths.ts';

/** A copy of the real repo's config and history, safe to corrupt. */
function scratchRepo(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-validate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(REPO_ROOT, 'config'), join(dir, 'config'), { recursive: true });
  cpSync(join(REPO_ROOT, 'history'), join(dir, 'history'), { recursive: true });
  cpSync(join(REPO_ROOT, 'index.html'), join(dir, 'index.html'));
  return dir;
}

test('the config this repo ships passes validation', () => {
  const report = validateAll();

  assert.deepEqual(report.failures, []);
  assert.ok(report.checked.length > 0);
});

test('every hand-editable file is actually checked', () => {
  const report = validateAll();

  for (const label of [
    'config/models.json',
    'config/genres.json',
    'config/generation.json',
    'config/guardrails.md',
    'config/reaction-config.json',
    'history/games.json',
    'history/summary.json',
  ]) {
    assert.ok(report.checked.includes(label), `${label} was never checked`);
  }
});

// One test per file, since a check silently dropped from the list would
// otherwise still leave the suite green.
for (const [label, contents] of [
  ['config/models.json', '{"models": []}'],
  ['config/genres.json', '[]'],
  ['config/generation.json', '{"remixProbability": 5}'],
  ['config/reaction-config.json', '{"endpointUrl": "http://insecure.test", "anonKey": null}'],
  ['history/games.json', '[{"date": "nope", "status": "published", "model": "m"}]'],
  ['history/summary.json', '{"popularityLeaderboard": "oops"}'],
] as const) {
  test(`a malformed ${label} fails validation and is named`, (t) => {
    const root = scratchRepo(t);
    writeFileSync(join(root, label), contents, 'utf8');

    const report = validateAll(createPaths(root));

    assert.ok(
      report.failures.some((failure) => failure.startsWith(`${label}:`)),
      `${label} was not reported: ${report.failures.join(' | ')}`,
    );
    assert.ok(!report.checked.includes(label));
  });
}

// Provisioning the store without widening the CSP drops every reaction
// silently, so validation has to catch it before a deploy does not.
test('a configured store the CSP does not permit fails validation', (t) => {
  const root = scratchRepo(t);
  writeFileSync(
    join(root, 'config/reaction-config.json'),
    JSON.stringify({ endpointUrl: 'https://proj.supabase.co/rest/v1/reactions', anonKey: null }),
    'utf8',
  );

  const report = validateAll(createPaths(root));

  assert.ok(
    report.failures.some((failure) => failure.includes('connect-src')),
    `expected a CSP failure, got: ${report.failures.join(' | ')}`,
  );
});

test('a configured store the CSP does permit passes validation', (t) => {
  const root = scratchRepo(t);
  const indexPath = join(root, 'index.html');
  writeFileSync(
    join(root, 'config/reaction-config.json'),
    JSON.stringify({ endpointUrl: 'https://proj.supabase.co/rest/v1/reactions', anonKey: null }),
    'utf8',
  );
  writeFileSync(
    indexPath,
    readFileSync(indexPath, 'utf8').replace(
      "connect-src 'self'",
      "connect-src 'self' https://proj.supabase.co",
    ),
    'utf8',
  );

  const report = validateAll(createPaths(root));

  assert.deepEqual(report.failures, []);
});

test('an unreadable guardrails file fails validation', (t) => {
  const root = scratchRepo(t);
  writeFileSync(join(root, 'config/guardrails.md'), '   \n', 'utf8');

  const report = validateAll(createPaths(root));

  assert.ok(report.failures.some((failure) => failure.startsWith('config/guardrails.md:')));
});

// A broken file must not hide the ones after it: a hand-edit session often
// breaks several, and reporting all of them costs one round trip.
test('every failure is reported, not just the first', (t) => {
  const root = scratchRepo(t);
  writeFileSync(join(root, 'config/models.json'), '{"models": []}', 'utf8');
  writeFileSync(join(root, 'config/genres.json'), '[]', 'utf8');

  const report = validateAll(createPaths(root));

  assert.equal(report.failures.length, 2);
});
