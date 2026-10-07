// Alongside moderate.test.ts, the safety-critical half of the pipeline:
// these confirm known-broken bundles are actually rejected.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
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

// A static HUD with a script that is only a comment: everything the
// renderedSomething check looks for is present, and nothing ever moves.
const INERT_SCRIPT = `// ${'placeholder '.repeat(100)}`;

test('rejects a static page whose script does nothing', async () => {
  const inert =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    `<body><div id="hud">Score: 0</div><script>${INERT_SCRIPT}</script></body></html>`;
  const result = await tester.test(inert, { settleMs: 300 });
  assert.equal(result.renderedSomething, true);
  assert.equal(result.activity, 'inert');
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(' '), /never changed/);
});

test('accepts a page that changes only in response to a key', async () => {
  const keyed =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div>' +
    '<script>addEventListener("keydown",()=>{document.getElementById("hud").textContent="Score: 1";});</script>' +
    '</body></html>';
  const result = await tester.test(keyed, { settleMs: 300 });
  assert.equal(result.activity, 'active');
  assert.equal(result.pass, true);
});

// Buttons styled explicitly so their default hover and focus appearance cannot
// change a screenshot: only a handler can make these pages differ.
const FLAT_STYLE =
  '<style>body{background:#123;color:#fff}' +
  'button{background:#444;color:#fff;border:0;outline:none}</style>';

test('accepts a page that changes only after its Start button is clicked', async () => {
  const startable =
    `<!doctype html><html><head>${FLAT_STYLE}</head>` +
    '<body><div id="hud">Press start</div><button id="go">Start</button>' +
    '<script>document.getElementById("go").addEventListener("click",()=>{' +
    'document.getElementById("hud").textContent="Playing";});</script>' +
    '</body></html>';
  const result = await tester.test(startable, { settleMs: 300 });
  assert.equal(result.activity, 'active');
  assert.equal(result.pass, true);
});

test('accepts a page whose Start click is undone by a later Reset click', async () => {
  const resettable =
    `<!doctype html><html><head>${FLAT_STYLE}</head>` +
    '<body><div id="hud">Press start</div><button id="go">Start</button>' +
    '<button id="reset">Reset</button>' +
    '<script>const hud=document.getElementById("hud");' +
    'document.getElementById("go").addEventListener("click",()=>{hud.textContent="Playing";});' +
    'document.getElementById("reset").addEventListener("click",()=>{hud.textContent="Press start";});' +
    '</script></body></html>';
  const result = await tester.test(resettable, { settleMs: 300 });
  assert.equal(result.activity, 'active');
});

test('rejects a static shell whose unstyled Start button does nothing', async () => {
  const noop =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Press start</div><button>Start</button></body></html>';
  const result = await tester.test(noop, { settleMs: 300 });
  assert.equal(result.renderedSomething, true);
  assert.equal(result.activity, 'inert');
});

test('rejects a static shell whose no-op button only gains a focus ring when clicked', async () => {
  const ringed =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}' +
    'button{background:#444;color:#fff;border:0}button:focus{outline:3px solid #f00}</style></head>' +
    '<body><div id="hud">Press start</div><button>Start</button></body></html>';
  const result = await tester.test(ringed, { settleMs: 300 });
  assert.equal(result.renderedSomething, true);
  assert.equal(result.activity, 'inert');
});

test('rejects a static shell whose no-op button sits below the fold', async () => {
  const belowFold =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Press start</div><div style="height:2000px"></div>' +
    '<button>Start</button></body></html>';
  const result = await tester.test(belowFold, { settleMs: 300 });
  assert.equal(result.renderedSomething, true);
  assert.equal(result.activity, 'inert');
});

test('accepts a page that moves right on ArrowRight and back on ArrowLeft', async () => {
  const reversible =
    '<!doctype html><html><head><style>body{background:#123;margin:0}' +
    '#dot{position:absolute;top:50px;left:50px;width:40px;height:40px;background:#fff}</style></head>' +
    '<body><div id="dot"></div>' +
    '<script>const dot=document.getElementById("dot");let x=50;' +
    'addEventListener("keydown",(e)=>{if(e.key==="ArrowRight")x+=100;if(e.key==="ArrowLeft")x-=100;' +
    'dot.style.left=x+"px";});</script></body></html>';
  const result = await tester.test(reversible, { settleMs: 300 });
  assert.equal(result.activity, 'active');
});

test('accepts a page that animates on its own', async () => {
  const animated =
    '<!doctype html><html><head><style>body{margin:0;background:#123}</style></head>' +
    '<body><canvas id="c" width="100" height="100"></canvas>' +
    '<script>const x=document.getElementById("c").getContext("2d");let n=0;' +
    '(function f(){x.fillStyle="hsl("+(n++*7)+",80%,50%)";x.fillRect(0,0,100,100);requestAnimationFrame(f);})();</script>' +
    '</body></html>';
  const result = await tester.test(animated, { settleMs: 300 });
  assert.equal(result.activity, 'active');
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

test('a page whose key handler never returns is cut off and read as a hang, not inert', async () => {
  const hangs =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div>' +
    '<script>addEventListener("keydown",()=>{while(true){}});</script></body></html>';
  const started = Date.now();
  const result = await tester.test(hangs, { settleMs: 300, probeTimeoutMs: 1500 });

  assert.ok(Date.now() - started < 15_000, 'the probe must give up rather than wait forever');
  assert.equal(result.pass, false);
  assert.equal(result.activity, 'unresponsive');
  assert.match(result.reasons.join(' '), /stopped responding to input/);
  assert.equal(smokeRejection(result, false).kind, 'smoke-unresponsive');
});

test('a page whose click handler never returns is cut off', async () => {
  const hangs =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div>' +
    '<script>addEventListener("click",()=>{while(true){}});</script></body></html>';
  const started = Date.now();
  const result = await tester.test(hangs, { settleMs: 300, probeTimeoutMs: 1500 });

  assert.ok(Date.now() - started < 15_000);
  assert.match(result.reasons.join(' '), /stopped responding to input/);
});

test('rejects a static shell whose no-op form button navigates the page', async () => {
  const form =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}' +
    'button{background:#444;color:#fff;border:0;outline:none}</style></head>' +
    '<body><div id="hud">Press start</div><form><button>Start</button></form></body></html>';
  const result = await tester.test(form, { settleMs: 300 });
  assert.equal(result.renderedSomething, true);
  assert.equal(result.activity, 'inert');
});

test('rejects a static page whose centre click only focuses a text input', async () => {
  const input =
    '<!doctype html><html><head><style>body{background:#123;color:#fff;margin:0}' +
    'input{position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;' +
    'color:#fff;font-size:40px;outline:none}</style></head>' +
    '<body><input type="text" aria-label="Notes"></body></html>';
  const result = await tester.test(input, { settleMs: 300 });
  assert.equal(result.renderedSomething, true);
  assert.equal(result.activity, 'inert');
});

test('accepts a game that sets location.hash from a key handler', async () => {
  // A same-document navigation keeps the page; only a real load is a reload.
  const hashing =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div>' +
    '<script>let n=0;addEventListener("keydown",()=>{' +
    'document.getElementById("hud").textContent="Score: "+(++n);location.hash="s"+n;});</script>' +
    '</body></html>';
  const result = await tester.test(hashing, { settleMs: 300 });
  assert.equal(result.activity, 'active');
  assert.equal(result.pass, true);
});

test('accepts a working game whose controls sit under a start overlay of dead buttons', async () => {
  // Every button is covered, so each click burns its whole timeout; the keys
  // must still get their turn well inside the probe budget.
  const cells = '<button>.</button>'.repeat(40);
  const overlaid =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}' +
    'button{background:#444;color:#fff;border:0;outline:none}' +
    '#overlay{position:fixed;inset:0;z-index:9;background:#000}</style></head>' +
    `<body><div id="hud">Score: 0</div><div id="grid">${cells}</div>` +
    '<div id="overlay">Press any key</div>' +
    '<script>addEventListener("keydown",()=>{document.getElementById("overlay").remove();});' +
    '</script></body></html>';
  const probeTimeoutMs = 8000;
  const started = Date.now();
  const result = await tester.test(overlaid, { settleMs: 300, probeTimeoutMs });

  assert.equal(result.activity, 'active');
  assert.ok(Date.now() - started < probeTimeoutMs, 'the buttons must not consume the budget');
});

test('rejects a static shell whose only element is a centred checkbox', async () => {
  // Clicking a native checkbox changes it with no script involved.
  const checkbox =
    '<!doctype html><html><head><style>body{background:#123;margin:0}' +
    'input{position:fixed;left:50%;top:50%;width:80px;height:80px;margin:-40px 0 0 -40px}' +
    '</style></head><body><input type="checkbox" aria-label="Toggle"></body></html>';
  const result = await tester.test(checkbox, { settleMs: 300 });
  assert.equal(result.renderedSomething, true);
  assert.equal(result.activity, 'inert');
  assert.equal(result.pass, false);
});

test('accepts a page that changes only on a key once its canvas is clicked and focused', async () => {
  // The canvas fills the viewport, so the centre click focuses it, and the
  // keys must still reach it.
  const focusedCanvas =
    '<!doctype html><html><head><style>body{margin:0;background:#123}' +
    'canvas{position:fixed;inset:0;width:100%;height:100%;outline:none}</style></head>' +
    '<body><canvas id="c" tabindex="0" width="100" height="100"></canvas>' +
    '<script>const c=document.getElementById("c");const x=c.getContext("2d");' +
    'x.fillStyle="#fff";x.fillRect(0,0,100,100);let n=0;' +
    'c.addEventListener("keydown",()=>{x.fillStyle="hsl("+(++n*50)+",80%,50%)";x.fillRect(0,0,50,50);});' +
    '</script></body></html>';
  const result = await tester.test(focusedCanvas, { settleMs: 300 });
  assert.equal(result.activity, 'active');
});
