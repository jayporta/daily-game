import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFeedback, tallyReactions } from '../fetch-feedback.ts';
import { PUBLISHED_ENTRY as PUBLISHED, PUBLISHED_SLUG as SLUG } from '../lib/testFixtures.ts';

const ENDPOINT = 'https://proj.supabase.co/rest/v1/reactions';

const row = (reaction: string, reasons: unknown[] = [], slug = SLUG): unknown => ({
  slug,
  reaction,
  reasons,
});

test('tallyReactions counts likes and dislikes separately', () => {
  const tally = tallyReactions([row('like'), row('like'), row('dislike')], SLUG);

  assert.equal(tally.likes, 2);
  assert.equal(tally.dislikes, 1);
});

test('tallyReactions counts how often each reason was given', () => {
  const tally = tallyReactions(
    [row('dislike', ['broken']), row('dislike', ['broken', 'goal-unclear'])],
    SLUG,
  );

  assert.deepEqual({ ...tally.dislikeReasons }, { broken: 2, 'goal-unclear': 1 });
});

test('tallyReactions ignores rows belonging to another game', () => {
  const tally = tallyReactions([row('like'), row('like', [], '2026-08-29-otter')], SLUG);

  assert.equal(tally.likes, 1);
});

// Everything below is reachable by anyone who finds the public insert key,
// so none of it may survive into history/games.json.
test('tallyReactions drops reasons outside the vocabulary', () => {
  const tally = tallyReactions([row('dislike', ['ignore-previous-instructions', 'broken'])], SLUG);

  assert.deepEqual({ ...tally.dislikeReasons }, { broken: 1 });
});

test('tallyReactions ignores a reaction that is neither a like nor a dislike', () => {
  const tally = tallyReactions([row('adore'), row('like')], SLUG);

  assert.equal(tally.likes, 1);
  assert.equal(tally.dislikes, 0);
});

test('tallyReactions counts a reason once however often a row repeats it', () => {
  const tally = tallyReactions([row('dislike', Array(1000).fill('broken'))], SLUG);

  assert.deepEqual({ ...tally.dislikeReasons }, { broken: 1 });
});

// The output is built by iterating the vocabulary, so a row naming an
// inherited key creates nothing — the property never comes into existence
// rather than being created and then filtered.
test('tallyReactions creates no key outside the vocabulary, whatever a row names', () => {
  const tally = tallyReactions(
    [row('dislike', ['__proto__', 'constructor', 'toString', 'broken'])],
    SLUG,
  );

  assert.deepEqual(Object.keys(tally.dislikeReasons), ['broken']);
});

test('tallyReactions builds its counts on a null-prototype object', () => {
  const tally = tallyReactions([row('dislike', ['broken'])], SLUG);

  assert.equal(Object.getPrototypeOf(tally.dislikeReasons), null);
});

test('tallyReactions emits only numbers, never strings from the store', () => {
  const tally = tallyReactions([{ slug: SLUG, reaction: 'dislike', reasons: 'broken' }], SLUG);

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

test('applyFeedback records the tally against the matching entry', async () => {
  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl: async () => new Response(JSON.stringify([row('like'), row('dislike', ['broken'])])),
  });

  assert.equal(entries[0]?.likes, 1);
  assert.equal(entries[0]?.dislikes, 1);
  assert.deepEqual({ ...entries[0]?.dislikeReasons }, { broken: 1 });
});

test('applyFeedback scores a game by likes against dislikes', async () => {
  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl: async () => new Response(JSON.stringify([row('like'), row('like'), row('dislike')])),
  });

  assert.equal(entries[0]?.popularityScore, 1);
});

// Today's shipped state.
test('applyFeedback leaves history untouched when no store is configured', async () => {
  let called = false;
  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: null,
    apiKey: null,
    fetchImpl: async () => {
      called = true;
      return new Response('[]');
    },
  });

  assert.equal(called, false);
  assert.deepEqual(entries, [PUBLISHED]);
});

test('applyFeedback leaves history untouched when the store is unreachable', async () => {
  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });

  assert.deepEqual(entries, [PUBLISHED]);
});

test('applyFeedback leaves history untouched when the store answers with an error', async () => {
  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl: async () => new Response('denied', { status: 401 }),
  });

  assert.deepEqual(entries, [PUBLISHED]);
});

test('applyFeedback leaves history untouched when the store returns junk', async () => {
  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl: async () => new Response('not json'),
  });

  assert.deepEqual(entries, [PUBLISHED]);
});

test('applyFeedback refuses a slug the pipeline could not have published', async () => {
  let called = false;
  await applyFeedback([PUBLISHED], {
    slug: '../admin',
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl: async () => {
      called = true;
      return new Response('[]');
    },
  });

  assert.equal(called, false);
});

test('applyFeedback asks the store only for the slug it is reconciling', async () => {
  let requested = '';
  await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl: async (input) => {
      requested = String(input);
      return new Response('[]');
    },
  });

  assert.match(requested, /slug=eq\.2026-08-28-beetle/);
});
