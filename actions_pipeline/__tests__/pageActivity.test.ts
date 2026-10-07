// Drives the smoke tester over pages built to exercise the activity probe:
// what counts as a live game, what reads as a static shell, and what the
// probe must ignore because the browser did it rather than the page.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { smokeRejection } from '#actions_pipeline/attemptOutcome.ts';
import { HANG_BUDGET_MS } from '#actions_pipeline/lib/testFixtures.ts';
import { createSmokeTester, type SmokeTester } from '#actions_pipeline/smokeTest.ts';

let tester: SmokeTester;

before(async () => {
  tester = await createSmokeTester();
});

after(async () => {
  await tester?.close();
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

test('a page whose key handler never returns is cut off and read as a hang, not inert', async () => {
  const hangs =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div>' +
    '<script>addEventListener("keydown",()=>{while(true){}});</script></body></html>';
  const started = Date.now();
  const result = await tester.test(hangs, { settleMs: 300, probeTimeoutMs: HANG_BUDGET_MS });

  assert.ok(Date.now() - started < 15_000, 'the probe must give up rather than wait forever');
  assert.equal(result.pass, false);
  assert.equal(result.activity, 'unresponsive');
  assert.match(result.reasons.join(' '), /stopped responding/);
  assert.equal(smokeRejection(result, false).kind, 'smoke-unresponsive');
});

test('a page whose click handler never returns is cut off', async () => {
  const hangs =
    '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head>' +
    '<body><div id="hud">Score: 0</div>' +
    '<script>addEventListener("click",()=>{while(true){}});</script></body></html>';
  const started = Date.now();
  const result = await tester.test(hangs, { settleMs: 300, probeTimeoutMs: HANG_BUDGET_MS });

  assert.ok(Date.now() - started < 15_000);
  assert.match(result.reasons.join(' '), /stopped responding/);
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

test('rejects a static page whose centre click only focuses an editable region', async () => {
  // The centre click focuses the region, and the probe's keys would type
  // into it; the letters they leave are not the page responding.
  const editable =
    '<!doctype html><html><head><style>body{background:#123;color:#fff;margin:0}' +
    '#pad{position:fixed;inset:0;font-size:40px;outline:none}</style></head>' +
    '<body><div id="pad" contenteditable="true"></div></body></html>';
  const result = await tester.test(editable, { settleMs: 300 });
  assert.equal(result.renderedSomething, true);
  assert.equal(result.activity, 'inert');
});

test('accepts a page whose only control is an input element styled as a button', async () => {
  const inputButton =
    `<!doctype html><html><head>${FLAT_STYLE}` +
    '<style>input{background:#444;color:#fff;border:0;outline:none}</style></head>' +
    '<body><div id="hud">Press start</div><input type="button" id="go" value="Start">' +
    '<script>document.getElementById("go").addEventListener("click",()=>{' +
    'document.getElementById("hud").textContent="Playing";});</script>' +
    '</body></html>';
  const result = await tester.test(inputButton, { settleMs: 300 });
  assert.equal(result.activity, 'active');
  assert.equal(result.pass, true);
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

test('rejects a static shell whose centred label toggles a checkbox', async () => {
  // Clicking the label's text toggles the box beside it with no script involved.
  const labelled =
    '<!doctype html><html><head><style>body{background:#123;color:#fff;margin:0}' +
    'label{position:fixed;left:50%;top:50%;width:200px;height:80px;margin:-40px 0 0 -100px;' +
    'font-size:30px}input{width:40px;height:40px}</style></head>' +
    '<body><label><input type="checkbox">Toggle</label></body></html>';
  const result = await tester.test(labelled, { settleMs: 300 });
  assert.equal(result.renderedSomething, true);
  assert.equal(result.activity, 'inert');
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
