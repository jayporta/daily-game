import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isPlaceholderMeta,
  OUTPUT_FORMAT_CONTRACT,
} from '#actions_pipeline/prompt/outputContract.ts';
import { extractBundle, toGeneratedMeta } from '#lib/extractBundleShared.ts';

// The prompt's format contract and the extractor's parser must agree, or
// every generation fails. Round-trip the contract's own example through
// the real extractor to keep them locked together.
test('the documented output format actually parses with extractBundle', () => {
  const modelStyleResponse = OUTPUT_FORMAT_CONTRACT.replace(
    '(the whole game: inline style and script, every line written out in full)',
    '<html><body><canvas></canvas></body></html>',
  ).replace(
    /\{"title".*\}/,
    '{"title": "T", "genre": "puzzle", "theme": "Th", "mechanics": ["m"], "controls": [{"action": "Go", "key": "G"}]}',
  );

  const result = extractBundle(modelStyleResponse);
  assert.ok(result.ok, 'contract example should parse');
  assert.equal(result.meta.title, 'T');
  assert.deepEqual(result.meta.controls, [{ action: 'Go', key: 'G' }]);
  assert.match(result.html, /<canvas>/);
});

// Models copy examples literally: an ellipsis or a code comment in the html
// example is what a model hands back as its game.
test('the contract html example body models no elision or placeholder comment', () => {
  const body = /```html\n([\s\S]*?)\n```/.exec(OUTPUT_FORMAT_CONTRACT)?.[1] ?? '';
  assert.notEqual(body, '', 'contract should show an html example');

  assert.doesNotMatch(body, /\.\.\.|…/, 'example body contains an elision marker');
  assert.doesNotMatch(body, /\/\/|\/\*|<!--/, 'example body contains a code comment');
});

test('the contract requires the whole game', () => {
  assert.match(OUTPUT_FORMAT_CONTRACT, /Write every line of the game/);
});

// The looser half of the same invariant: a field can be added to the
// extractor and quietly never asked for. Then every game ships without it
// and nothing fails.
test('every field the extractor produces is named in the output contract', () => {
  const result = extractBundle('```json\n{}\n```\n```html\n<p>x</p>\n```');
  assert.ok(result.ok);

  for (const field of Object.keys(result.meta)) {
    assert.match(
      OUTPUT_FORMAT_CONTRACT,
      new RegExp(`\\b${field}\\b`),
      `the contract never mentions "${field}", so no model will return it`,
    );
  }
});

test('the contract example anchors the model to none of our own content', () => {
  const example = /^\{.*\}$/m.exec(OUTPUT_FORMAT_CONTRACT)?.[0] ?? '';
  assert.notEqual(example, '', 'contract should show an example meta object');

  // Walks the contract's example, independently of the extractor.
  const leaves: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') leaves.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
  };
  walk(JSON.parse(example));

  assert.ok(leaves.length > 0, 'example should contain values');
  // Models copy examples literally. A concrete key or title here would push
  // every game toward whatever we happened to write.
  assert.deepEqual([...new Set(leaves)], ['...']);
});

// Guards PLACEHOLDER_TEXT against drifting away from the contract's own
// example: if the example's placeholder ever changes, this fails instead of
// isPlaceholderMeta silently missing the model's own literal copy of it.
test('isPlaceholderMeta rejects the contract example verbatim, with a real genre', () => {
  const example = /^\{.*\}$/m.exec(OUTPUT_FORMAT_CONTRACT)?.[0] ?? '';
  assert.notEqual(example, '', 'contract should show an example meta object');

  const parsed = toGeneratedMeta(JSON.parse(example));

  assert.equal(isPlaceholderMeta({ ...parsed, genre: 'maze-adventure' }), true);
});

const REAL_META = {
  title: 'Beetle of a Thousand Mirrors',
  genre: 'maze-adventure',
  theme: 'glass beetles navigating a mirrored maze',
  mechanics: ['arrow-key movement', 'collect shards'],
  controls: [{ action: 'Move', key: 'Arrow keys' }],
};

test('isPlaceholderMeta accepts a real, fully-described game', () => {
  assert.equal(isPlaceholderMeta(REAL_META), false);
});

test('isPlaceholderMeta rejects the contract example echoed verbatim, even with a real genre', () => {
  // The exact shape that published a black-screen game on 2026-09-12: a
  // valid genre paired with the example's placeholder everywhere else, which
  // the genre check alone cannot catch.
  assert.equal(
    isPlaceholderMeta({
      title: '...',
      genre: 'racing',
      theme: '...',
      mechanics: ['...', '...'],
      controls: [{ action: '...', key: '...' }],
    }),
    true,
  );
});

test('isPlaceholderMeta rejects a placeholder title alone', () => {
  assert.equal(isPlaceholderMeta({ ...REAL_META, title: '...' }), true);
});

test('isPlaceholderMeta rejects a placeholder theme alone', () => {
  assert.equal(isPlaceholderMeta({ ...REAL_META, theme: '...' }), true);
});

test('isPlaceholderMeta rejects a placeholder mechanic among real ones', () => {
  assert.equal(isPlaceholderMeta({ ...REAL_META, mechanics: ['arrow-key movement', '...'] }), true);
});

test('isPlaceholderMeta rejects a placeholder control among real ones', () => {
  assert.equal(
    isPlaceholderMeta({
      ...REAL_META,
      controls: [
        { action: 'Move', key: 'Arrow keys' },
        { action: '...', key: '...' },
      ],
    }),
    true,
  );
});
