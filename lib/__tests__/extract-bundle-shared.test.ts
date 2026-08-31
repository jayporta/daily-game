import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBundle } from '../extract-bundle-shared.ts';

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

// An array parses as JSON but carries none of the meta fields, so admitting
// it only defers the failure to the field reads. Rejecting costs a retry —
// what every other format violation here costs.
test('rejects a meta block holding an array rather than an object', () => {
  const response = '```json\n[{"title":"x"}]\n```\n```html\n<div>game</div>\n```';

  const result = extractBundle(response);

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

/** A response whose meta block is exactly `meta`, with a valid html block. */
function responseWithMeta(meta: unknown): string {
  return `\`\`\`json\n${JSON.stringify(meta)}\n\`\`\`\n\`\`\`html\n<div>game</div>\n\`\`\``;
}

const BASE_META = { title: 'x', genre: 'y', theme: 'z', mechanics: [] };

test('extracts the controls the game reports', () => {
  const result = extractBundle(
    responseWithMeta({
      ...BASE_META,
      controls: [
        { action: 'Steer', key: 'Arrow keys' },
        { action: 'Boost', key: 'Shift' },
      ],
    }),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.meta.controls, [
    { action: 'Steer', key: 'Arrow keys' },
    { action: 'Boost', key: 'Shift' },
  ]);
});

test('a game that reports no controls is still a valid bundle', () => {
  const result = extractBundle(responseWithMeta({ ...BASE_META, controls: [] }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.meta.controls, []);
});

// The field is new; a model that omits it should not cost the day its game.
test('a response omitting controls entirely still extracts', () => {
  const result = extractBundle(responseWithMeta(BASE_META));

  assert.equal(result.ok, true);
  assert.deepEqual(result.meta.controls, []);
});

test('controls that are not a list are discarded', () => {
  const result = extractBundle(responseWithMeta({ ...BASE_META, controls: 'W to move' }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.meta.controls, []);
});

test('a control missing either half is dropped', () => {
  const result = extractBundle(
    responseWithMeta({
      ...BASE_META,
      controls: [{ action: 'Jump' }, { key: 'Space' }, { action: 'Fire', key: 'F' }],
    }),
  );

  assert.deepEqual(result.ok === true && result.meta.controls, [{ action: 'Fire', key: 'F' }]);
});

test('control text is trimmed', () => {
  const result = extractBundle(
    responseWithMeta({ ...BASE_META, controls: [{ action: '  Jump  ', key: ' Space ' }] }),
  );

  assert.deepEqual(result.ok === true && result.meta.controls, [
    { action: 'Jump', key: 'Space' },
  ]);
});

// Everything below renders in the parent page, so none of it may run away.
test('an over-long control is truncated rather than shown in full', () => {
  const result = extractBundle(
    responseWithMeta({ ...BASE_META, controls: [{ action: 'a'.repeat(500), key: 'b'.repeat(500) }] }),
  );

  const [control] = result.ok === true ? result.meta.controls : [];
  assert.ok((control?.action.length ?? 0) <= 40, 'action was not bounded');
  assert.ok((control?.key.length ?? 0) <= 40, 'key was not bounded');
});

test('a runaway number of controls is capped', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ action: `Do ${i}`, key: `K${i}` }));

  const result = extractBundle(responseWithMeta({ ...BASE_META, controls: many }));

  assert.ok((result.ok === true ? result.meta.controls.length : 0) <= 10);
});

test('controls that are not objects are dropped', () => {
  const result = extractBundle(
    responseWithMeta({ ...BASE_META, controls: [null, 'W', 42, ['a'], { action: 'Go', key: 'G' }] }),
  );

  assert.deepEqual(result.ok === true && result.meta.controls, [{ action: 'Go', key: 'G' }]);
});

// A model repeating itself would otherwise render the same row twice and
// hand React two identical keys.
test('a control reported twice is kept once', () => {
  const result = extractBundle(
    responseWithMeta({
      ...BASE_META,
      controls: [
        { action: 'Move', key: 'Arrow keys' },
        { action: 'Move', key: 'Arrow keys' },
        { action: 'Jump', key: 'Space' },
      ],
    }),
  );

  assert.deepEqual(result.ok === true && result.meta.controls, [
    { action: 'Move', key: 'Arrow keys' },
    { action: 'Jump', key: 'Space' },
  ]);
});

test('the same action on a different input is kept, not merged', () => {
  const result = extractBundle(
    responseWithMeta({
      ...BASE_META,
      controls: [
        { action: 'Move', key: 'Arrow keys' },
        { action: 'Move', key: 'WASD' },
      ],
    }),
  );

  assert.equal(result.ok === true && result.meta.controls.length, 2);
});

test('duplicates are removed before the cap, not after', () => {
  const controls = Array.from({ length: 40 }, () => ({ action: 'Move', key: 'Arrows' })).concat(
    Array.from({ length: 5 }, (_, i) => ({ action: `Act ${i}`, key: `K${i}` })),
  );

  const result = extractBundle(responseWithMeta({ ...BASE_META, controls }));

  // Without dedup-before-cap, 40 identical entries eat the whole budget and
  // the five real controls never appear.
  assert.equal(result.ok === true && result.meta.controls.length, 6);
});
