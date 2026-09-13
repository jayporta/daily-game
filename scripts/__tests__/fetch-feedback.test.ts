import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFeedback } from '#scripts/fetch-feedback.ts';
import {
  neverAnswers,
  PUBLISHED_ENTRY as PUBLISHED,
  publishedAt,
  reactionRow as row,
  PUBLISHED_SLUG as SLUG,
} from '#scripts/lib/testFixtures.ts';

const ENDPOINT = 'https://proj.supabase.co/rest/v1/reactions';

// A store that has not had the reaction_counts view applied yet: PostgREST
// answers 404 for a relation it does not know, which is what sends a read
// back to the table. Every fake below starts here, so the table-path tests
// keep testing the table.
function viewAbsent(input: RequestInfo | URL): Response | null {
  return String(input).includes('reaction_counts')
    ? new Response('no such relation', { status: 404 })
    : null;
}

// A store that caps a page below what the read asked for, the way PostgREST
// clamps a range wider than its own max-rows.
function pagedStore(rows: unknown[], maxRows: number, pastEndStatus = 200) {
  const ranges: string[] = [];
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const absent = viewAbsent(input);
    if (absent !== null) return absent;

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
  const fetchImpl: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const absent = viewAbsent(input);
      if (absent !== null) {
        resolve(absent);
        return;
      }

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

// A store with the reaction_counts view in place. Reading the table answers an
// error, so a test that passes here proves the view was the only thing read.
function countsStore(rows: unknown[]) {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    if (!String(input).includes('reaction_counts')) {
      return new Response('the table should not be read', { status: 500 });
    }
    return new Response(JSON.stringify(rows));
  };
  return { fetchImpl, urls };
}

// Every table-path test above now reaches the table through the view's 404, so
// the fallback itself is covered by all of them.
test('applyFeedback counts a game from the aggregate view', async () => {
  const { fetchImpl } = countsStore([
    { slug: SLUG, likes: 12, dislikes: 3, 'no-load': 2, 'goal-unclear': 1 },
  ]);

  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
  });

  const entry = publishedAt(entries, 0);
  assert.deepEqual(
    { likes: entry.likes, dislikes: entry.dislikes, reasons: { ...entry.dislikeReasons } },
    { likes: 12, dislikes: 3, reasons: { 'no-load': 2, 'goal-unclear': 1 } },
  );
});

// The point of the view: one row crosses the network however popular the game.
test('applyFeedback reads the view in a single request', async () => {
  const { fetchImpl, urls } = countsStore([{ slug: SLUG, likes: 4000, dislikes: 10 }]);

  await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
  });

  assert.deepEqual(urls.length, 1);
});

// Only a view that does not exist falls back. Falling back on any error would
// read every row of a popular game each time the store had a bad minute.
test('applyFeedback leaves history untouched when the view refuses the read', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    return new Response('server error', { status: 500 });
  };

  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
  });

  assert.deepEqual({ entries, requests: urls.length }, { entries: [PUBLISHED], requests: 1 });
});

// The view groups by slug, so a game nobody reacted to has no row. That is a
// tally of zero, not a failed read.
test('applyFeedback records zeros for a game the view has no row for', async () => {
  const { fetchImpl } = countsStore([]);

  const entries = await applyFeedback([PUBLISHED], {
    slug: SLUG,
    endpointUrl: ENDPOINT,
    apiKey: 'service-key',
    fetchImpl,
  });

  assert.equal(publishedAt(entries, 0).popularityScore, 0);
});
