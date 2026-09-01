import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAll, validateCspAllowsEndpoint } from '#scripts/validate-config.ts';
import { createPaths, REPO_ROOT, paths } from '#scripts/lib/paths.ts';

const CSP_SELF_ONLY = '<meta content="connect-src \'self\'; form-action \'none\'" />';
const CSP_WITH_STORE =
  '<meta content="connect-src \'self\' https://proj.supabase.co; form-action \'none\'" />';

/** Stands in for the caller-supplied consequence; the wording is not under test. */
const BLOCKED = 'drop the data silently';

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
    'config/byok-models.json',
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
  ['config/byok-models.json', '[]'],
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

// The mirror image of the reaction-store trap, and the reason the Sentry
// check exists: the appended snippet runs inside the sandboxed frame, which
// inherits this CSP, so an unlisted ingest origin means no game ever reports
// an error and nothing anywhere says so.
test('a configured Sentry DSN the CSP does not permit fails validation', (t) => {
  const root = scratchRepo(t);
  const indexPath = join(root, 'index.html');
  writeFileSync(
    indexPath,
    readFileSync(indexPath, 'utf8').replace(' https://o4512003238199296.ingest.us.sentry.io', ''),
    'utf8',
  );

  const report = validateAll(createPaths(root));

  assert.ok(
    report.failures.some((failure) => failure.startsWith('index.html (CSP allows Sentry ingest)')),
    `expected a Sentry CSP failure, got: ${report.failures.join(' | ')}`,
  );
});

// A DSN carries its public key as URL userinfo. That is why the check can
// take one unchanged — but only because `origin` drops the userinfo, so a
// DSN and a bare endpoint on the same host resolve identically.
test('validateCspAllowsEndpoint ignores a DSN\'s userinfo when matching', () => {
  const result = validateCspAllowsEndpoint(
    'https://pubkey@proj.supabase.co/12345',
    CSP_WITH_STORE,
    BLOCKED,
  );

  assert.equal(result.valid, true);
});

// BYOK calls are made from the parent page, not the sandboxed frame, so a
// missing origin here would silently block every generation in production
// while every other test — none of which enforces CSP — stayed green.
test("index.html's connect-src lists all four BYOK provider origins", () => {
  const html = readFileSync(paths.indexHtml, 'utf8');
  const policy = /content="([^"]*connect-src[^"]*)"/i.exec(html)?.[1] ?? '';

  for (const origin of [
    'https://openrouter.ai',
    'https://api.anthropic.com',
    'https://api.openai.com',
    'https://generativelanguage.googleapis.com',
  ]) {
    assert.ok(policy.includes(origin), `connect-src is missing ${origin}`);
  }
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

test('validateCspAllowsEndpoint passes when no store is configured', () => {
  assert.deepEqual(validateCspAllowsEndpoint(null, CSP_SELF_ONLY, BLOCKED), {
    valid: true,
    errors: [],
  });
});

// The trap this exists for: a configured store the CSP does not permit means
// the browser blocks every reaction and sendReaction swallows the failure, so
// nothing anywhere reports it.
test('validateCspAllowsEndpoint rejects a store the CSP would block', () => {
  const result = validateCspAllowsEndpoint(
    'https://proj.supabase.co/rest/v1/reactions',
    CSP_SELF_ONLY,
    BLOCKED,
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /https:\/\/proj\.supabase\.co/);
});

test('validateCspAllowsEndpoint passes once the origin is listed', () => {
  const result = validateCspAllowsEndpoint(
    'https://proj.supabase.co/rest/v1/reactions',
    CSP_WITH_STORE,
    BLOCKED,
  );

  assert.equal(result.valid, true);
});

// A prefix match would accept an attacker-controlled lookalike origin.
test('validateCspAllowsEndpoint matches whole origins, not substrings', () => {
  const result = validateCspAllowsEndpoint(
    'https://proj.supabase.co.evil.test/rest/v1/reactions',
    CSP_WITH_STORE,
    BLOCKED,
  );

  assert.equal(result.valid, false);
});

test('validateCspAllowsEndpoint rejects an endpoint that is not a URL', () => {
  assert.equal(validateCspAllowsEndpoint('not a url', CSP_WITH_STORE, BLOCKED).valid, false);
});

test('validateCspAllowsEndpoint reports a page with no connect-src at all', () => {
  const result = validateCspAllowsEndpoint(
    'https://proj.supabase.co/x',
    '<meta content="" />',
    BLOCKED,
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /no connect-src/);
});
