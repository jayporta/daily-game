import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_STRING_FIELDS,
  fetchText,
  fetchManifest,
  isManifest,
  manifestUrl,
} from '../manifest-client.ts';
import { MANIFEST as VALID } from '../../../lib/testFixtures.ts';

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

// Checked field by field, over the guard's own list: a guard that silently
// stopped validating one of these would let a partial manifest through and
// render blank metadata.
for (const field of REQUIRED_STRING_FIELDS) {
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

test('isManifest requires the controls list', () => {
  const { controls: _omitted, ...withoutControls } = VALID;

  assert.equal(isManifest(withoutControls), false);
});

test('isManifest accepts a game that reported no controls', () => {
  assert.equal(isManifest({ ...VALID, controls: [] }), true);
});

test('isManifest rejects controls that are not a list', () => {
  assert.equal(isManifest({ ...VALID, controls: 'W to move' }), false);
});

// The manifest is written by our pipeline, but it is fetched over the wire
// and a half-written one should fail visibly rather than render blanks.
test('isManifest rejects a control missing either half', () => {
  assert.equal(isManifest({ ...VALID, controls: [{ action: 'Jump' }] }), false);
  assert.equal(isManifest({ ...VALID, controls: [{ key: 'Space' }] }), false);
});

test('isManifest rejects a control whose halves are not strings', () => {
  assert.equal(isManifest({ ...VALID, controls: [{ action: 1, key: 2 }] }), false);
});
