import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBundle } from './extract-bundle-shared.ts';

const GOOD_RESPONSE = `Here is your game:

\`\`\`json
{"title": "Beetle Maze", "genre": "maze-adventure", "theme": "glass beetles", "mechanics": ["move", "collect keys"]}
\`\`\`

\`\`\`html
<!doctype html><html><body><canvas id="c"></canvas><script>console.log("hi")</script></body></html>
\`\`\`

Enjoy!`;

test('extracts a well-formed response with surrounding prose', () => {
  const result = extractBundle(GOOD_RESPONSE);
  assert.equal(result.ok, true);
  assert.equal(result.meta.title, 'Beetle Maze');
  assert.equal(result.meta.genre, 'maze-adventure');
  assert.equal(result.meta.theme, 'glass beetles');
  assert.deepEqual(result.meta.mechanics, ['move', 'collect keys']);
  assert.match(result.html, /<canvas/);
});

test('handles blocks in either order', () => {
  const swapped = `\`\`\`html\n<div>game</div>\n\`\`\`\n\`\`\`json\n{"title":"x","genre":"y","theme":"z","mechanics":[]}\n\`\`\``;
  const result = extractBundle(swapped);
  assert.equal(result.ok, true);
  assert.equal(result.meta.title, 'x');
  assert.match(result.html, /<div>game<\/div>/);
});

test('rejects response missing the json block', () => {
  const result = extractBundle('```html\n<div>hi</div>\n```');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-meta-block');
});

test('rejects response missing the html block', () => {
  const result = extractBundle('```json\n{"title":"x"}\n```');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-html-block');
});

test('rejects malformed JSON in the meta block', () => {
  const result = extractBundle('```json\n{not valid json}\n```\n```html\n<div></div>\n```');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-json-meta');
});

test('rejects an empty html block', () => {
  const result = extractBundle('```json\n{"title":"x"}\n```\n```html\n\n```');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'empty-html');
});

test('rejects non-string input', () => {
  const result = extractBundle(undefined);
  assert.equal(result.ok, false);
});
