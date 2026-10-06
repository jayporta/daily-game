import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPlaceholderScript, MIN_SCRIPT_CHARS } from '#actions_pipeline/placeholderScript.ts';

/** A script body of at least `chars` non-whitespace characters of real-looking code. */
function realCode(chars: number): string {
  const statement = 'state.score = state.score + 1;\n';
  return statement.repeat(Math.ceil(chars / statement.replace(/\s/g, '').length));
}

function page(scriptBody: string, extra = ''): string {
  return `<!doctype html><html><body><canvas id="c"></canvas>${extra}<script>${scriptBody}</script></body></html>`;
}

test('a script holding only a placeholder comment is a placeholder', () => {
  assert.equal(isPlaceholderScript(page('\n    // Game code here\n  ')), true);
});

test('a page with no script is a placeholder', () => {
  assert.equal(isPlaceholderScript('<!doctype html><html><body><h1>Hi</h1></body></html>'), true);
});

test('a few declarations followed by an elision comment is a placeholder', () => {
  const stub = `
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    let score = 0;
    let running = true;
    function update() { /* ... */ }
    function draw() { ctx.clearRect(0, 0, canvas.width, canvas.height); }
    // ... more code
  `;
  assert.equal(isPlaceholderScript(page(stub)), true);
});

test('a block comment standing in for the game is a placeholder', () => {
  assert.equal(isPlaceholderScript(page(`/* ${'implement the game here '.repeat(100)} */`)), true);
});

test('a script with real code over the floor is not a placeholder', () => {
  assert.equal(isPlaceholderScript(page(realCode(MIN_SCRIPT_CHARS + 50))), false);
});

test('a script just under the floor is a placeholder and just over it is not', () => {
  assert.equal(isPlaceholderScript(page(realCode(MIN_SCRIPT_CHARS - 40))), true);
  assert.equal(isPlaceholderScript(page(realCode(MIN_SCRIPT_CHARS + 40))), false);
});

// A script that loads from elsewhere is not the game's code, and the sandbox
// allows no network, so only inline code counts. A browser ignores the body of
// a script that has a src, so that body is not the game either.
test('an external script beside an empty inline one is a placeholder', () => {
  const external = `<script src="game.js">${realCode(MIN_SCRIPT_CHARS * 2)}</script>`;
  const html = page('// Game code here', external);
  assert.equal(isPlaceholderScript(html), true);
});

test('code in several inline scripts adds up', () => {
  const half = realCode(MIN_SCRIPT_CHARS / 2 + 50);
  const html = `<html><body><script>${half}</script><script>${half}</script></body></html>`;
  assert.equal(isPlaceholderScript(html), false);
});

test('a data block beside a placeholder script does not count as code', () => {
  const data = `<script type="application/json">${JSON.stringify({ levels: realCode(MIN_SCRIPT_CHARS * 2) })}</script>`;
  assert.equal(isPlaceholderScript(page('// Game code here', data)), true);
});

test('a module script counts as code', () => {
  const html = `<html><body><script type="module">${realCode(MIN_SCRIPT_CHARS + 50)}</script></body></html>`;
  assert.equal(isPlaceholderScript(html), false);
});

test('a block-comment opener inside a line comment does not swallow the code after it', () => {
  const html = page(`// assets live under src/*\n${realCode(MIN_SCRIPT_CHARS + 50)}\n/* end */`);
  assert.equal(isPlaceholderScript(html), false);
});

test('a URL in a game written on one line keeps the rest of that line', () => {
  const oneLine = `const ns='http://www.w3.org/2000/svg';${realCode(MIN_SCRIPT_CHARS + 50).replace(/\n/g, '')}`;
  assert.equal(isPlaceholderScript(page(oneLine)), false);
});

test('data- attributes and legacy script types do not hide a real game', () => {
  const code = realCode(MIN_SCRIPT_CHARS + 50);
  for (const attributes of [
    ' data-src="x"',
    ' data-type="x"',
    ' type="text/ecmascript"',
    ' type="application/x-javascript"',
  ]) {
    const html = `<html><body><script${attributes}>${code}</script></body></html>`;
    assert.equal(isPlaceholderScript(html), false, attributes);
  }
});

test('a script of exactly the floor is not a placeholder and one character fewer is', () => {
  assert.equal(isPlaceholderScript(page('a'.repeat(MIN_SCRIPT_CHARS))), false);
  assert.equal(isPlaceholderScript(page('a'.repeat(MIN_SCRIPT_CHARS - 1))), true);
});

test('a script inside an HTML comment does not count as code', () => {
  const commented = `<!-- <script>${realCode(MIN_SCRIPT_CHARS * 2)}</script> -->`;
  assert.equal(isPlaceholderScript(page('// Game code here', commented)), true);
});

test('a line comment straight after code does not open a block comment', () => {
  const html = page(`let a = 1;// see src/*\n${realCode(MIN_SCRIPT_CHARS + 50)}\n/* end */`);
  assert.equal(isPlaceholderScript(html), false);
});
