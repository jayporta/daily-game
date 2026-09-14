import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildErrorReportingSnippet, parseSentryDsn } from '#scripts/lib/errorReporting.ts';

const DSN = 'https://pub1ickey@o42.ingest.example/4567';
const SLUG = '2026-08-29-beetle';
const RELEASE = 'c0ffee1';

test('parseSentryDsn reads the key, host and project id', () => {
  assert.deepEqual(parseSentryDsn(DSN), {
    protocol: 'https:',
    host: 'o42.ingest.example',
    publicKey: 'pub1ickey',
    projectId: '4567',
  });
});

// A DSN with no `key@` cannot authenticate, and would post into the void.
test('parseSentryDsn rejects a dsn carrying no public key', () => {
  assert.equal(parseSentryDsn('https://o42.ingest.example/4567'), null);
});

test('parseSentryDsn rejects a dsn with no project id', () => {
  assert.equal(parseSentryDsn('https://pub1ickey@o42.ingest.example/'), null);
});

test('parseSentryDsn rejects a non-numeric project id', () => {
  assert.equal(parseSentryDsn('https://pub1ickey@o42.ingest.example/not-a-project'), null);
});

test('parseSentryDsn rejects a value that is not a URL', () => {
  assert.equal(parseSentryDsn('nonsense'), null);
});

test('buildErrorReportingSnippet is empty while Sentry is unprovisioned', () => {
  assert.equal(buildErrorReportingSnippet(null, SLUG, RELEASE), '');
});

// A typo must disable reporting, never emit a snippet that posts nowhere.
test('buildErrorReportingSnippet is empty for an unparseable dsn', () => {
  assert.equal(buildErrorReportingSnippet('https://no-key-here/4567', SLUG, RELEASE), '');
});

// The DSN itself is not an endpoint — posting to it 404s. Sentry ingests at
// /api/<projectId>/envelope/, authenticated by query string.
test('buildErrorReportingSnippet posts to the envelope endpoint, not the dsn', () => {
  const snippet = buildErrorReportingSnippet(DSN, SLUG, RELEASE);

  assert.match(
    snippet,
    /https:\/\/o42\.ingest\.example\/api\/4567\/envelope\/\?sentry_key=pub1ickey&sentry_version=7/,
  );
});

test('buildErrorReportingSnippet never embeds the raw dsn', () => {
  assert.doesNotMatch(buildErrorReportingSnippet(DSN, SLUG, RELEASE), /pub1ickey@/);
});

test('buildErrorReportingSnippet tags events with the slug', () => {
  assert.match(buildErrorReportingSnippet(DSN, SLUG, RELEASE), /2026-08-29-beetle/);
});

// Sentry rejects a bare event object: the body is three newline-delimited
// JSON lines — envelope header, item header, payload.
test('buildErrorReportingSnippet builds a three-line envelope body', () => {
  const snippet = buildErrorReportingSnippet(DSN, SLUG, RELEASE);

  assert.match(snippet, /sent_at/);
  assert.match(snippet, /\{ type: 'event' \}/);
  assert.equal(snippet.split("+ '\\n' +").length - 1, 2);
});

test('buildErrorReportingSnippet reports uncaught errors and rejected promises', () => {
  const snippet = buildErrorReportingSnippet(DSN, SLUG, RELEASE);

  assert.match(snippet, /addEventListener\('error'/);
  assert.match(snippet, /addEventListener\('unhandledrejection'/);
});

// The page may be dying as it reports, so the request has to outlive it.
test('buildErrorReportingSnippet sends with keepalive', () => {
  assert.match(buildErrorReportingSnippet(DSN, SLUG, RELEASE), /keepalive: true/);
});

// Without it every event from a published game files under no deploy, so
// there is no telling an error today's publish introduced from one that has
// been shipping for a fortnight.
test('the snippet tags its events with the release that published them', () => {
  const snippet = buildErrorReportingSnippet(DSN, SLUG, RELEASE);

  assert.match(snippet, /var RELEASE = "c0ffee1"/);
  assert.match(snippet, /release: RELEASE/);
});
