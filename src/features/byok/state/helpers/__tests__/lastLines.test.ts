import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lastLines } from '#src/features/byok/state/helpers/lastLines.ts';

/** The obvious implementation, kept here as the thing to agree with. */
function naive(text: string, limit: number): string {
  const lines = text.split('\n');
  return lines.length <= limit ? text : lines.slice(-limit).join('\n');
}

test('a string with fewer lines than the limit comes back whole', () => {
  assert.equal(lastLines('first\nsecond\nthird', 120), 'first\nsecond\nthird');
});

test('a longer string keeps only its last lines', () => {
  assert.equal(lastLines('a\nb\nc\nd', 2), 'c\nd');
});

// The console repaints on every streamed fragment, against everything
// received so far, so this is the case the backwards scan exists for.
test('a 200k-character generation agrees with the obvious implementation', () => {
  const text = Array.from({ length: 20_000 }, (_, index) => `line ${index} of output`).join('\n');
  assert.ok(text.length > 200_000, `wanted a big input, got ${text.length} characters`);

  assert.equal(lastLines(text, 120), naive(text, 120));
});

test('the edges agree with the obvious implementation too', () => {
  for (const text of ['', '\n', 'one', 'one\n', '\none', 'a\n\nb', 'a\nb\n\n']) {
    for (const limit of [1, 2, 3, 120]) {
      assert.equal(
        lastLines(text, limit),
        naive(text, limit),
        `disagreed on ${JSON.stringify(text)} at limit ${limit}`,
      );
    }
  }
});
