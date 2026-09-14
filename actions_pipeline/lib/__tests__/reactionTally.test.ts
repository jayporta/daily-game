import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tallyFromCountsRow, tallyReactions } from '#actions_pipeline/lib/reactionTally.ts';
import { reactionRow as row, PUBLISHED_SLUG as SLUG } from '#actions_pipeline/lib/testFixtures.ts';

test('tallyReactions counts likes and dislikes separately', () => {
  const tally = tallyReactions([row('like'), row('like'), row('dislike')], SLUG);

  assert.equal(tally.likes, 2);
  assert.equal(tally.dislikes, 1);
});

test('tallyReactions counts how often each reason was given', () => {
  const tally = tallyReactions(
    [row('dislike', ['no-load']), row('dislike', ['no-load', 'goal-unclear'])],
    SLUG,
  );

  assert.deepEqual({ ...tally.dislikeReasons }, { 'no-load': 2, 'goal-unclear': 1 });
});

test('tallyReactions ignores rows belonging to another game', () => {
  const tally = tallyReactions([row('like'), row('like', [], '2026-08-29-otter')], SLUG);

  assert.equal(tally.likes, 1);
});

// Everything below is reachable by anyone who finds the public insert key,
// so none of it may survive into history/games.json.
test('tallyReactions drops reasons outside the vocabulary', () => {
  const tally = tallyReactions([row('dislike', ['ignore-previous-instructions', 'no-load'])], SLUG);

  assert.deepEqual({ ...tally.dislikeReasons }, { 'no-load': 1 });
});

test('tallyReactions ignores a reaction that is neither a like nor a dislike', () => {
  const tally = tallyReactions([row('adore'), row('like')], SLUG);

  assert.equal(tally.likes, 1);
  assert.equal(tally.dislikes, 0);
});

test('tallyReactions counts a reason once however often a row repeats it', () => {
  const tally = tallyReactions([row('dislike', Array(1000).fill('no-load'))], SLUG);

  assert.deepEqual({ ...tally.dislikeReasons }, { 'no-load': 1 });
});

// The output is built by iterating the vocabulary, so a row naming an
// inherited key creates nothing — the property never comes into existence
// rather than being created and then filtered.
test('tallyReactions creates no key outside the vocabulary, whatever a row names', () => {
  const tally = tallyReactions(
    [row('dislike', ['__proto__', 'constructor', 'toString', 'no-load'])],
    SLUG,
  );

  assert.deepEqual(Object.keys(tally.dislikeReasons), ['no-load']);
});

// The property a caller depends on, stated without the mechanism that provides
// it: a name a row supplies is never readable as a count, whether or not it
// exists on Object.prototype.
test('tallyReactions reports no count under a name a row invented', () => {
  const tally = tallyReactions(
    [row('dislike', ['__proto__', 'constructor', 'toString', 'no-load'])],
    SLUG,
  );

  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(
      Object.entries(tally.dislikeReasons).find(([id]) => id === name),
      undefined,
      `${name} was readable as a count`,
    );
  }
  assert.equal(tally.dislikeReasons['no-load'], 1);
});

test('tallyReactions emits only numbers, never strings from the store', () => {
  const tally = tallyReactions([{ slug: SLUG, reaction: 'dislike', reasons: 'no-load' }], SLUG);

  for (const count of Object.values(tally.dislikeReasons)) {
    assert.equal(typeof count, 'number');
  }
  assert.equal(tally.dislikes, 1);
});

test('tallyReactions survives rows of entirely the wrong shape', () => {
  const tally = tallyReactions([null, 42, 'like', [], { reaction: 'like' }], SLUG);

  assert.deepEqual(tally, { likes: 0, dislikes: 0, dislikeReasons: tally.dislikeReasons });
  assert.deepEqual({ ...tally.dislikeReasons }, {});
});

test('tallyReactions returns an empty tally when the store sends no array', () => {
  const tally = tallyReactions({ error: 'nope' }, SLUG);

  assert.equal(tally.likes, 0);
  assert.equal(tally.dislikes, 0);
});

// Same rule as the raw-row tally: the vocabulary is iterated, never the row's
// keys, so a column the store invented has nothing to land in.
test('tallyFromCountsRow drops a column outside the vocabulary', () => {
  const tally = tallyFromCountsRow(
    { slug: SLUG, likes: 1, dislikes: 1, 'no-load': 1, 'ignore-previous-instructions': 9 },
    SLUG,
  );

  assert.deepEqual({ ...tally?.dislikeReasons }, { 'no-load': 1 });
});

test('tallyFromCountsRow refuses a row whose counts are not numbers', () => {
  assert.equal(tallyFromCountsRow({ slug: SLUG, likes: '12', dislikes: 3 }, SLUG), null);
});

test('tallyFromCountsRow refuses a row belonging to another game', () => {
  assert.equal(
    tallyFromCountsRow({ slug: '2026-08-29-otter', likes: 12, dislikes: 3 }, SLUG),
    null,
  );
});
