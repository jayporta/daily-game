// Alongside moderate.test.ts, the safety-critical half of the pipeline:
// these confirm known-broken bundles are actually rejected.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadFixtureBundle } from '#scripts/lib/testFixtures.ts';
import { createSmokeTester, type SmokeTester } from '#scripts/smoke-test.ts';

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

test('rejects a bundle that renders nothing visible', async () => {
  const blank =
    '<!doctype html><html><body><canvas id="c" width="50" height="50"></canvas></body></html>';
  const result = await tester.test(blank, { settleMs: 300 });
  assert.equal(result.renderedSomething, false);
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(' '), /rendered nothing visible/);
});

test('rejects the output contract skeleton returned verbatim', async () => {
  const skeleton =
    '<!doctype html><html><head><style>/* game styles */</style></head>' +
    '<body><canvas id="gameCanvas"></canvas><script>// game logic</script></body></html>';
  const result = await tester.test(skeleton, { settleMs: 300 });
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(' '), /rendered nothing visible/);
});

test('accepts a canvas game that paints its background but draws on first input', async () => {
  // DISPLAY_CONTRACT tells every game to paint its own background, so one
  // that waits for input before drawing is still visibly there.
  const waitsForInput =
    '<!doctype html><html><head><style>body{background:#123}</style></head>' +
    '<body><canvas id="c" width="50" height="50"></canvas>' +
    '<script>addEventListener("keydown",()=>{' +
    'const x=document.getElementById("c").getContext("2d");x.fillRect(0,0,50,50);});</script>' +
    '</body></html>';
  const result = await tester.test(waitsForInput, { settleMs: 300 });
  assert.equal(result.canvasDrawn, false);
  assert.equal(result.pass, true);
});

// The canvas is read in strips rather than one allocation, so paint that
// falls outside the first strip still has to be found.
test('finds paint below the first strip of a tall canvas', async () => {
  const paintsLow =
    '<!doctype html><html><head><style>body{background:#123}</style></head>' +
    '<body><canvas id="c" width="20" height="300"></canvas>' +
    '<script>const x=document.getElementById("c").getContext("2d");' +
    'x.fillRect(0,290,20,10);</script></body></html>';
  const result = await tester.test(paintsLow, { settleMs: 300 });

  assert.equal(result.canvasDrawn, true);
});

test('a hidden painted element does not count as rendering something', async () => {
  const hidden =
    '<!doctype html><html><body><div style="visibility:hidden;background:#f00;' +
    'width:80px;height:80px"></div></body></html>';
  const result = await tester.test(hidden, { settleMs: 300 });
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(' '), /rendered nothing visible/);
});

test('accepts a game that renders DOM content without drawing to a canvas', async () => {
  const domGame =
    '<!doctype html><html><body><canvas id="c" width="50" height="50"></canvas>' +
    '<div id="board">Score: 0</div></body></html>';
  const result = await tester.test(domGame, { settleMs: 300 });
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
