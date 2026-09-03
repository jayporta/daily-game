import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorMessage } from '#lib/errors.ts';

test('errorMessage reports an Error by its message', () => {
  assert.equal(errorMessage(new Error('rate limited')), 'rate limited');
});

test('errorMessage passes a thrown string through', () => {
  assert.equal(errorMessage('plain string failure'), 'plain string failure');
});

// These reach the page and history/games.json as the explanation.
test('errorMessage never renders a thrown non-Error as "undefined"', () => {
  for (const thrown of [undefined, null, 42, { code: 'ENOENT' }, ['a']]) {
    const message = errorMessage(thrown);
    assert.notEqual(message, 'undefined', `${JSON.stringify(thrown)} rendered as "undefined"`);
    assert.ok(message.length > 0, `${JSON.stringify(thrown)} rendered as an empty string`);
  }
});

test('errorMessage falls back for an Error carrying no message', () => {
  assert.ok(errorMessage(new Error('')).length > 0);
});

test('errorMessage survives a value that cannot be coerced to a string', () => {
  // A null-prototype object has no `toString`, so `String(value)` throws.
  const uncoercible = Object.create(null) as unknown;

  assert.doesNotThrow(() => errorMessage(uncoercible));
  assert.ok(errorMessage(uncoercible).length > 0);
});
