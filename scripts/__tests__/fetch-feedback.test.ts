import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFeedback, tallyReactions } from '#scripts/fetch-feedback.ts';
import {
  neverAnswers,
  PUBLISHED_ENTRY as PUBLISHED,
  publishedAt,
  PUBLISHED_SLUG as SLUG,
} from '#scripts/lib/testFixtures.ts';

const ENDPOINT = 'https://proj.supabase.co/rest/v1/reactions';

const row = (reaction: string, reasons: unknown[] = [], slug = SLUG): unknown => ({
  slug,
  reaction,
  reasons,
});

// A store that caps a page below what the read asked for, the way PostgREST
// clamps a range wider than its own max-rows.
function pagedStore(rows: unknown[], maxRows: number, pastEndStatus = 200) {
  const ranges: string[] = [];
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const range = new Headers(init?.headers).get('Range') ?? '';
    ranges.push(range);
    urls.push(String(input));
    const from = Number(range.split('-')[0]);
    if (from >= rows.length && pastEndStatus === 416) {
      return new Response('range not satisfiable', { status: 416 });
    }
    return new Response(JSON.stringify(rows.slice(from, from + maxRows)));
  };
  return { fetchImpl, ranges, urls };
}

// A paged store that takes `delayMs` to answer each page and abandons a
// request the moment its signal fires.
function slowPagedStore(rows: unknown[], maxRows: number, delayMs: number) {
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise<Response>((resolve, reject) => {
      const from = Number(new Headers(init?.headers).get('Range')?.split('-')[0]);
      const timer = setTimeout(
        () => resolve(new Response(JSON.stringify(rows.slice(from, from + maxRows)))),
        delayMs,
      );
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('request aborted'));
      });
    });
  return { fetchImpl };
}

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

// What the null-prototype object above this used to guard, stated as the
// property a caller depends on rather than the mechanism: a name a row
// supplies is never readable as a count, whether or not it exists on
// Object.prototype.
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

test('applyFeedback records the tally against the matching entry', async () => {
  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl: pagedStore([row('like'), row('dislike', ['no-load'])], 1_000).fetchImpl,
  });

  const entry = publishedAt(entries, 0);
  assert.equal(entry.likes, 1);
  assert.equal(entry.dislikes, 1);
  assert.deepEqual({ ...entry.dislikeReasons }, { 'no-load': 1 });
});

test('applyFeedback scores a game by likes against dislikes', async () => {
  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl: pagedStore([row('like'), row('like'), row('dislike')], 1_000).fetchImpl,
  });

  assert.equal(publishedAt(entries, 0).popularityScore, 1);
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

// A store that accepts the connection and then goes quiet is the one failure
// the catch above cannot see. This runs before generation starts, so without
// a timeout it stalls a run that has not yet tried to generate anything.
test(
  'applyFeedback leaves history untouched when the store never answers',
  { timeout: 5_000 },
  async () => {
    const entries = await applyFeedback([PUBLISHED], {
      slug: SLUG,
      endpointUrl: ENDPOINT,
      apiKey: 'service-key',
      fetchImpl: neverAnswers,
      timeoutMs: 20,
    });

    assert.deepEqual(entries, [PUBLISHED]);
  },
);

// The defect this guards: one request returns the store's page limit with no
// sign that more rows exist, so a popular game tallies as an unpopular one.
test('applyFeedback counts rows the store could not fit in one page', async () => {
  const rows = [...Array.from({ length: 5 }, () => row('like')), row('dislike'), row('dislike')];
  const { fetchImpl, ranges } = pagedStore(rows, 3);

  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
  });

  const entry = publishedAt(entries, 0);
  assert.equal(entry.likes, 5);
  assert.equal(entry.dislikes, 2);
  assert.ok(ranges.length > 1, 'expected more than one page to be requested');
});

test('applyFeedback stops when the store reports the offset is past the last row', async () => {
  const { fetchImpl } = pagedStore([row('like'), row('like')], 3, 416);

  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
  });

  assert.equal(publishedAt(entries, 0).likes, 2);
});

// applyFeedback documents that it never throws. timeoutMs is a caller-supplied
// field, and AbortSignal.timeout rejects anything but a whole positive number.
test('applyFeedback leaves history untouched when the timeout is unusable', async () => {
  const { fetchImpl } = pagedStore([row('like')], 3);

  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
    timeoutMs: -1,
  });

  assert.deepEqual(entries, [PUBLISHED]);
});

// One deadline covers the whole read rather than restarting per page. Each
// page here answers inside the timeout and only the pages together outrun it,
// so a per-request timer would let the read run as long as there are pages.
test('applyFeedback leaves history untouched when the pages together outlast the timeout', async () => {
  const { fetchImpl } = slowPagedStore(
    Array.from({ length: 6 }, () => row('like')),
    2,
    200,
  );

  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
    timeoutMs: 300,
  });

  assert.deepEqual(entries, [PUBLISHED]);
});

// A game landing exactly on the cap is complete, not truncated: the read has
// every row it will ever get, and one empty probe is what proves it.
test('applyFeedback counts a game sitting exactly on the page cap', async () => {
  const { fetchImpl } = pagedStore(
    Array.from({ length: 60 }, () => row('like')),
    3,
  );

  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
  });

  assert.equal(publishedAt(entries, 0).likes, 60);
});

// Anyone who loads the page holds the insert key, so one slug's row count is
// not something this side controls. A tally cut short would undercount in
// exactly the way the pagination exists to prevent.
test('applyFeedback leaves history untouched when a game has more rows than one read may fetch', async () => {
  const { fetchImpl } = pagedStore(
    Array.from({ length: 61 }, () => row('like')),
    3,
  );

  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
  });

  assert.deepEqual(entries, [PUBLISHED]);
});

// Every other failure here leaves history alone. A refused first page must
// too: an empty tally would overwrite the entry's real counts with zeros.
test('applyFeedback leaves history untouched when the store refuses the first range', async () => {
  const { fetchImpl } = pagedStore([], 3, 416);

  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
  });

  assert.deepEqual(entries, [PUBLISHED]);
});

// Offset paging is a consistent partition of the rows only while the store
// sorts them, and anyone holding the public key can insert mid-read.
test('applyFeedback asks the store for a stable row order', async () => {
  const { fetchImpl, urls } = pagedStore([row('like')], 3);

  await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
  });

  assert.ok(
    urls.length > 0 && urls.every((url) => url.includes('order=id')),
    `every request must order by id, got ${JSON.stringify(urls)}`,
  );
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
