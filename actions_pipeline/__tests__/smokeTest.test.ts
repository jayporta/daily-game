// Alongside moderate.test.ts, the safety-critical half of the pipeline:
// these confirm known-broken bundles are actually rejected.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { HANG_BUDGET_MS } from '#actions_pipeline/__tests__/hangBudget.ts';
import { smokeRejection } from '#actions_pipeline/attemptOutcome.ts';
import { loadFixtureBundle } from '#actions_pipeline/lib/testFixtures.ts';
import { createSmokeTester, type SmokeTester } from '#actions_pipeline/smokeTest.ts';

let tester: SmokeTester;

before(async () => {
  tester = await createSmokeTester();
});

after(async () => {
  await tester?.close();
});

test('accepts the known-good fixtures', async () => {
  for (const name of ['goodMaze', 'goodPlatformer'] as const) {
    const { html } = loadFixtureBundle(name);
    const result = await tester.test(html);
    assert.equal(result.pass, true, `${name} should pass: ${result.reasons.join('; ')}`);
    assert.equal(result.reach, 'observed', `${name} should load and be observed`);
    assert.equal(result.canvasDrawn, true, `${name} should draw to its canvas`);
    assert.equal(result.activity, 'active', `${name} should respond`);
  }
});

test('rejects a bundle that throws a JS error', async () => {
  const { html } = loadFixtureBundle('badJsError');
  const result = await tester.test(html);
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(' '), /uncaught JS error/);
  assert.match(result.pageErrors.join(' '), /thisFunctionDoesNotExist/);
});

test('rejects a bundle that attempts a network request', async () => {
  const { html } = loadFixtureBundle('badFetchAttempt');
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
    '<div id="board">Score: 0</div>' +
    '<script>let n=0;setInterval(()=>{document.getElementById("board").textContent="Score: "+(++n);},50);</script>' +
    '</body></html>';
  const result = await tester.test(domGame, { settleMs: 300 });
  assert.equal(result.canvasDrawn, false);
  assert.equal(result.pass, true);
  assert.match(result.warnings.join(' '), /nothing was drawn/);
});

test('data: URLs are not treated as network use', async () => {
  const withDataUri =
    '<!doctype html><html><body><canvas id="c" width="10" height="10"></canvas>' +
    '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">' +
    '<script>const x=document.getElementById("c").getContext("2d");x.fillRect(0,0,10,10);' +
    'let n=0;setInterval(()=>{x.fillStyle="hsl("+(++n*40)+",80%,50%)";x.fillRect(0,0,10,10);},50);</script>' +
    '</body></html>';
  const result = await tester.test(withDataUri, { settleMs: 300 });
  assert.deepEqual(result.networkAttempts, []);
  assert.equal(result.pass, true);
});

test('blocks and records a request made by a popup a click opens', async () => {
  const popup =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div><button id="go">Go</button>' +
    '<script>document.getElementById("go").addEventListener("click",()=>{window.open("http://example.com/popup");});</script>' +
    '</body></html>';
  const result = await tester.test(popup, { settleMs: 300 });
  assert.equal(result.pass, false);
  assert.match(result.networkAttempts.join(' '), /example\.com\/popup/);
});

test('a page whose script never yields while loading is cut off and read as a hang, not a load failure', async () => {
  // `load` never fires, so setting the document is the call that never returns.
  const hangs =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div><script>while(true){}</script></body></html>';
  const started = Date.now();
  const result = await tester.test(hangs, { settleMs: 300, probeTimeoutMs: HANG_BUDGET_MS });

  assert.ok(Date.now() - started < 15_000, 'loading must give up rather than wait forever');
  assert.equal(result.reach, 'observed');
  assert.equal(result.activity, 'unresponsive');
  assert.equal(result.pass, false);
  assert.equal(smokeRejection(result, false).kind, 'smoke-unresponsive');
});

test('a page that hangs after loading is cut off and read as a hang, not blank', async () => {
  // The script blocks the main thread during the settle window, so the read
  // of what it rendered is the call that never returns.
  const hangs =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div>' +
    '<script>setTimeout(()=>{while(true){}},100);</script></body></html>';
  const started = Date.now();
  const result = await tester.test(hangs, { settleMs: 300, probeTimeoutMs: HANG_BUDGET_MS });

  assert.ok(Date.now() - started < 15_000, 'the read must give up rather than wait forever');
  assert.equal(result.reach, 'observed');
  assert.equal(result.activity, 'unresponsive');
  assert.equal(result.pass, false);
  assert.doesNotMatch(result.reasons.join(' '), /rendered nothing/);
  assert.equal(smokeRejection(result, false).kind, 'smoke-unresponsive');
});

test('a page that closes itself while probed is unobserved, not blank or inert', async () => {
  // The close lands after the settle window and well before an inert probe
  // ends, so the probe is running when the page goes away and every browser
  // call it makes from then on throws.
  const closes =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div><script>setTimeout(()=>window.close(),1500);</script>' +
    '</body></html>';
  const result = await tester.test(closes, { settleMs: 300 });
  assert.equal(result.pass, false);
  assert.equal(result.reach, 'unobserved');
  assert.equal(result.activity, null);
  assert.deepEqual(
    result.reasons.map((reason) => reason.replace(/:.*$/, '')),
    ['page loaded but could not be observed'],
  );
  assert.equal(smokeRejection(result, false).kind, 'smoke-unobserved');
});

test('a page that closes itself while settling is unobserved, not a load failure', async () => {
  // The document loaded; what failed came after.
  const closes =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div><script>setTimeout(()=>window.close(),100);</script>' +
    '</body></html>';
  const result = await tester.test(closes, { settleMs: 600 });
  assert.equal(result.reach, 'unobserved');
  assert.match(result.reasons.join(' '), /could not be observed/);
});
