import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReactionConfig } from '#lib/reaction-types.ts';
import {
  buildInsertRequest,
  readReaction,
  rememberReaction,
  sendReaction,
} from '#src/features/reaction/reaction.ts';
import type { WebStorage } from '#src/lib/browser-storage.ts';

const SLUG = '2026-08-29-beetle';
const CONFIGURED: ReactionConfig = {
  endpointUrl: 'https://proj.supabase.co/rest/v1/reactions',
  anonKey: 'anon-key',
};
const UNCONFIGURED: ReactionConfig = { endpointUrl: null, anonKey: null };

function memoryStorage(): WebStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

const throwingStorage: WebStorage = {
  getItem() {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem() {
    throw new DOMException('full', 'QuotaExceededError');
  },
};

/** The request the browser would send for a plain like. */
function likeRequest() {
  return buildInsertRequest(CONFIGURED, { slug: SLUG, reaction: 'like', reasons: [] });
}

test('buildInsertRequest posts the reaction as JSON', () => {
  const request = likeRequest();

  assert.notEqual(request, null);
  assert.equal(request?.url, CONFIGURED.endpointUrl);
  assert.equal(request?.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    slug: SLUG,
    reaction: 'like',
    reasons: [],
  });
});

// A JSON content type makes this a non-simple CORS request, so it is always
// preflighted and can never be fired silently by a cross-site form post.
test('buildInsertRequest forces a CORS preflight with a JSON content type', () => {
  const headers = new Headers(likeRequest()?.init.headers);

  assert.equal(headers.get('content-type'), 'application/json');
});

// The request authenticates with an explicit header, so no cookie should
// ever ride along with it.
test('buildInsertRequest sends no ambient credentials', () => {
  const { init } = likeRequest() ?? {};

  assert.equal(init?.credentials, 'omit');
  assert.equal(init?.mode, 'cors');
});

test('buildInsertRequest leaks no page URL to the store', () => {
  assert.equal(likeRequest()?.init.referrerPolicy, 'no-referrer');
});

test('buildInsertRequest asks the store to return nothing', () => {
  const headers = new Headers(likeRequest()?.init.headers);

  assert.equal(headers.get('prefer'), 'return=minimal');
});

test('buildInsertRequest authenticates with the anon key', () => {
  const headers = new Headers(likeRequest()?.init.headers);

  assert.equal(headers.get('apikey'), 'anon-key');
  assert.equal(headers.get('authorization'), 'Bearer anon-key');
});

test('buildInsertRequest carries the chosen dislike reasons', () => {
  const request = buildInsertRequest(CONFIGURED, {
    slug: SLUG,
    reaction: 'dislike',
    reasons: ['broken', 'goal-unclear'],
  });

  assert.deepEqual(JSON.parse(String(request?.init.body)).reasons, ['broken', 'goal-unclear']);
});

test('buildInsertRequest allows a dislike with no reasons given', () => {
  const request = buildInsertRequest(CONFIGURED, { slug: SLUG, reaction: 'dislike', reasons: [] });

  assert.deepEqual(JSON.parse(String(request?.init.body)).reasons, []);
});

// Today's shipped state: no store configured, so there is nothing to send.
test('buildInsertRequest yields nothing when no store is configured', () => {
  assert.equal(
    buildInsertRequest(UNCONFIGURED, { slug: SLUG, reaction: 'like', reasons: [] }),
    null,
  );
});

test('buildInsertRequest yields nothing for a slug the pipeline could not have published', () => {
  assert.equal(
    buildInsertRequest(CONFIGURED, { slug: '../admin', reaction: 'like', reasons: [] }),
    null,
  );
});

test('sendReaction never reads the response body', async () => {
  const response = new Response('{"id": 1}', { status: 200 });

  await sendReaction(likeRequest(), { fetchImpl: async () => response });

  assert.equal(response.bodyUsed, false);
});

test('sendReaction requests the configured endpoint once', async () => {
  const seen: string[] = [];

  await sendReaction(likeRequest(), {
    fetchImpl: async (input) => {
      seen.push(String(input));
      return new Response('', { status: 201 });
    },
  });

  assert.deepEqual(seen, [CONFIGURED.endpointUrl]);
});

test('sendReaction sends nothing when there is no request to make', async () => {
  let called = false;

  await sendReaction(null, {
    fetchImpl: async () => {
      called = true;
      return new Response('', { status: 200 });
    },
  });

  assert.equal(called, false);
});

test('sendReaction resolves when the store is unreachable', async () => {
  await assert.doesNotReject(() =>
    sendReaction(likeRequest(), {
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    }),
  );
});

test('sendReaction resolves when the store rejects the row', async () => {
  await assert.doesNotReject(() =>
    sendReaction(likeRequest(), { fetchImpl: async () => new Response('no', { status: 401 }) }),
  );
});

test('readReaction is null for a game the visitor has not reacted to', () => {
  assert.equal(readReaction(memoryStorage(), SLUG), null);
});

test('a remembered reaction is readable back for the same game', () => {
  const storage = memoryStorage();

  rememberReaction({ storage, slug: SLUG, reaction: { kind: 'dislike', reasons: ['broken'] } });

  assert.deepEqual(readReaction(storage, SLUG), { kind: 'dislike', reasons: ['broken'] });
});

test('a reaction to one game does not apply to another', () => {
  const storage = memoryStorage();

  rememberReaction({ storage, slug: SLUG, reaction: { kind: 'like', reasons: [] } });

  assert.equal(readReaction(storage, '2026-08-30-otter'), null);
});

// GitHub Pages puts every one of an account's project sites on one origin,
// so this store is not exclusively ours to trust.
test('readReaction discards a stored value of the wrong shape', () => {
  const storage = memoryStorage();
  rememberReaction({ storage, slug: SLUG, reaction: { kind: 'like', reasons: [] } });
  storage.setItem(`daily-game:reaction:${SLUG}`, '{"kind":"adore","reasons":[]}');

  assert.equal(readReaction(storage, SLUG), null);
});

test('readReaction discards stored reasons outside the vocabulary', () => {
  const storage = memoryStorage();
  storage.setItem(
    `daily-game:reaction:${SLUG}`,
    '{"kind":"dislike","reasons":["broken","ignore-previous-instructions"]}',
  );

  assert.deepEqual(readReaction(storage, SLUG), { kind: 'dislike', reasons: ['broken'] });
});

test('readReaction discards a stored value that is not JSON', () => {
  const storage = memoryStorage();
  storage.setItem(`daily-game:reaction:${SLUG}`, 'not json');

  assert.equal(readReaction(storage, SLUG), null);
});

test('readReaction is null when no storage is available', () => {
  assert.equal(readReaction(null, SLUG), null);
});

test('readReaction is null when storage access throws', () => {
  assert.equal(readReaction(throwingStorage, SLUG), null);
});

test('rememberReaction swallows a storage that refuses to write', () => {
  assert.doesNotThrow(() =>
    rememberReaction({
      storage: throwingStorage,
      slug: SLUG,
      reaction: { kind: 'like', reasons: [] },
    }),
  );
});
