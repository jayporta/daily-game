import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_STRING_FIELDS, isManifest } from '../manifest.ts';
import { MANIFEST as VALID } from '../../src/lib/testFixtures.ts';

test('isManifest accepts a well-formed manifest', () => {
  assert.equal(isManifest(VALID), true);
});
test('isManifest rejects the seed-state null manifest', () => {
  assert.equal(isManifest(null), false);
});
test('isManifest rejects an object missing required fields', () => {
  assert.equal(isManifest({ slug: 'x' }), false);
});
test('isManifest rejects a field of the wrong type', () => {
  assert.equal(isManifest({ ...VALID, generatedAt: 12345 }), false);
});
test('isManifest requires the controls list', () => {
  const { controls: _omitted, ...withoutControls } = VALID;

  assert.equal(isManifest(withoutControls), false);
});
test('isManifest accepts a game that reported no controls', () => {
  assert.equal(isManifest({ ...VALID, controls: [] }), true);
});
// An archive published before prompts were archived carries no prompt.txt,
// and a game is still worth showing without the BYOK remix it enables.
test('isManifest accepts a manifest with no archived prompt', () => {
  const { promptPath: _omitted, ...withoutPrompt } = VALID;

  assert.equal(isManifest(withoutPrompt), true);
});
test('isManifest rejects a promptPath that is present but not a string', () => {
  assert.equal(isManifest({ ...VALID, promptPath: 42 }), false);
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
