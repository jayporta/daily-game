// Drives the smoke tester over pages built to exercise the activity probe:
// what counts as a live game, what reads as a static shell, and what the
// probe must ignore because the browser did it rather than the page.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { HANG_BUDGET_MS } from '#actions_pipeline/__tests__/hangBudget.ts';
import { smokeRejection } from '#actions_pipeline/attemptOutcome.ts';
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
