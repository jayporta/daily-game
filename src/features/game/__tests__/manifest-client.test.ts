import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchText, fetchManifest, manifestUrl } from '#src/features/game/manifest-client.ts';
import { MANIFEST as VALID, jsonResponse } from '#src/lib/testFixtures.ts';

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

// The manifest is the only file that changes at a fixed URL; the bundle and
// the prompt live under the day's slug and never do.
test('fetchText lets the browser cache an immutable published file', async () => {
  let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_url, init) => {
    capturedInit = init;
    return new Response('the game', { status: 200 });
  };

  await fetchText('games/archive/2026-08-29-beetle/game.html', { fetchImpl });

  assert.equal(capturedInit?.cache, undefined);
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

test('fetchText returns the file text', async () => {
  const html = await fetchText('games/archive/x/game.html', {
    fetchImpl: async () => new Response('<html></html>', { status: 200 }),
  });
  assert.equal(html, '<html></html>');
});

test('fetchText throws on an HTTP error', async () => {
  await assert.rejects(
    () =>
      fetchText('missing.html', {
        fetchImpl: async () => new Response('', { status: 500 }),
      }),
    /could not load game \(500\)/,
  );
});

