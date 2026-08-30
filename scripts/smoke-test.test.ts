// Alongside moderate.test.ts, the safety-critical half of the pipeline:
// these confirm known-broken bundles are actually rejected.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSmokeTester, type SmokeTester } from './smoke-test.ts';
import { loadFixtureBundle } from './lib/fixtures.ts';

let tester: SmokeTester;

before(async () => {
  tester = await createSmokeTester();
});

after(async () => {
  await tester?.close();
});

test('accepts the known-good fixtures', async () => {
  for (const name of ['good-maze', 'good-platformer'] as const) {
    const { html } = loadFixtureBundle(name);
    const result = await tester.test(html);
    assert.equal(result.pass, true, `${name} should pass: ${result.reasons.join('; ')}`);
    assert.equal(result.canvasDrawn, true, `${name} should draw to its canvas`);
  }
});

test('rejects a bundle that throws a JS error', async () => {
  const { html } = loadFixtureBundle('bad-js-error');
  const result = await tester.test(html);
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(' '), /uncaught JS error/);
  assert.match(result.pageErrors.join(' '), /thisFunctionDoesNotExist/);
});

test('rejects a bundle that attempts a network request', async () => {
  const { html } = loadFixtureBundle('bad-fetch-attempt');
  const result = await tester.test(html);
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(' '), /not self-contained/);
  assert.match(result.networkAttempts.join(' '), /example\.com/);
});

test('an allowlisted origin does not fail the bundle', async () => {
  // Epic 6 relies on this to permit exactly Sentry's ingest domain.
  const { html } = loadFixtureBundle('bad-fetch-attempt');
  const result = await tester.test(html, { allowedNetworkOrigins: ['https://example.com'] });
  assert.deepEqual(result.networkAttempts, []);
  assert.doesNotMatch(result.reasons.join(' '), /not self-contained/);
});

test('reports a blank canvas as a soft warning, not a failure', async () => {
  const blank = '<!doctype html><html><body><canvas id="c" width="50" height="50"></canvas></body></html>';
  const result = await tester.test(blank, { settleMs: 300 });
  assert.equal(result.canvasDrawn, false);
  assert.equal(result.pass, true);
  assert.match(result.warnings.join(' '), /nothing was drawn/);
});

test('data: URLs are not treated as network use', async () => {
  const withDataUri =
    '<!doctype html><html><body><canvas id="c" width="10" height="10"></canvas>' +
    '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">' +
    '<script>const x=document.getElementById("c").getContext("2d");x.fillRect(0,0,10,10);</script>' +
    '</body></html>';
  const result = await tester.test(withDataUri, { settleMs: 300 });
  assert.deepEqual(result.networkAttempts, []);
  assert.equal(result.pass, true);
});
