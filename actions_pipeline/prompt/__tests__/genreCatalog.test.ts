import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GENRES } from '#actions_pipeline/lib/testFixtures.ts';
import { formatGenreCatalog } from '#actions_pipeline/prompt/genreCatalog.ts';

test('formatGenreCatalog marks recently used genres for avoidance', () => {
  const catalog = formatGenreCatalog(GENRES, ['puzzle']);
  assert.match(catalog, /puzzle \(Puzzle\) \[RECENTLY USED — avoid\]/);
  assert.doesNotMatch(catalog, /platformer \(Platformer\) \[RECENTLY USED/);
});
