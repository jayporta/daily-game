import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGameHtml, fetchManifest, isManifest, manifestUrl } from './manifest-client.ts';

const VALID = {
  date: '2026-08-29',
  slug: '2026-08-29-beetle',
  path: 'games/archive/2026-08-29-beetle/game.html',
  title: 'Beetle Maze',
  genre: 'maze-adventure',
  model: 'a/model:free',
  generatedAt: '2026-08-29T13:04:00.000Z',
  expiresAt: '2026-08-30T13:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test('isManifest accepts a well-formed manifest', () => {
  assert.equal(isManifest(VALID), true);
});

test('isManifest rejects the seed-state null manifest', () => {
  assert.equal(isManifest(null), false);
});

test('isManifest rejects an object missing required fields', () => {
  assert.equal(isManifest({ slug: 'x' }), false);
});

// Checked field by field: a guard that silently stopped validating one of
// these would let a partial manifest through and render blank metadata.
for (const field of ['date', 'slug', 'path', 'title', 'genre', 'model', 'generatedAt', 'expiresAt']) {
  test(`isManifest rejects a manifest missing ${field}`, () => {
    const partial: Record<string, unknown> = { ...VALID };
    delete partial[field];
    assert.equal(isManifest(partial), false);
  });
}

test('isManifest rejects a field of the wrong type', () => {
  assert.equal(isManifest({ ...VALID, generatedAt: 12345 }), false);
});

test('manifestUrl is cache-busted', () => {
  assert.equal(manifestUrl(1234), 'manifest.json?t=1234');
});

test('fetchManifest returns the parsed manifest', async () => {
  const manifest = await fetchManifest({ fetchImpl: async () => jsonResponse(VALID) });
  assert.equal(manifest?.slug, '2026-08-29-beetle');
});

test('fetchManifest returns null when no game is published yet', async () => {
  const manifest = await fetchManifest({ fetchImpl: async () => jsonResponse(null) });
  assert.equal(manifest, null);
});

test('fetchManifest throws on an HTTP error', async () => {
  await assert.rejects(
    () => fetchManifest({ fetchImpl: async () => jsonResponse({}, 404) }),
    /could not load manifest \(404\)/,
  );
});

test('fetchManifest requests a cache-busted url', async () => {
  let requested = '';
  await fetchManifest({
    now: 999,
    fetchImpl: async (url) => {
      requested = String(url);
      return jsonResponse(VALID);
    },
  });
  assert.equal(requested, 'manifest.json?t=999');
});

test('fetchGameHtml returns the bundle text', async () => {
  const html = await fetchGameHtml('games/archive/x/game.html', {
    fetchImpl: async () => new Response('<html></html>', { status: 200 }),
  });
  assert.equal(html, '<html></html>');
});

test('fetchGameHtml throws on an HTTP error', async () => {
  await assert.rejects(
    () =>
      fetchGameHtml('missing.html', {
        fetchImpl: async () => new Response('', { status: 500 }),
      }),
    /could not load game \(500\)/,
  );
});
