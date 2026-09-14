import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateGenresConfig } from '#scripts/lib/config/genres.ts';

test('validateGenresConfig accepts a valid config', () => {
  const errors: string[] = [];
  const valid = validateGenresConfig(
    [{ id: 'maze', label: 'Maze', examples: ['ex1', 'ex2'] }],
    errors,
  );
  assert.equal(valid, true);
});

test('validateGenresConfig rejects duplicate ids', () => {
  const errors: string[] = [];
  const valid = validateGenresConfig(
    [
      { id: 'maze', label: 'Maze', examples: ['ex1'] },
      { id: 'maze', label: 'Maze Again', examples: ['ex2'] },
    ],
    errors,
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('duplicated')));
});

test('validateGenresConfig rejects empty examples array entries', () => {
  const errors: string[] = [];
  const valid = validateGenresConfig([{ id: 'maze', label: 'Maze', examples: [] }], errors);
  assert.equal(valid, false);
});

test('validateGenresConfig reports validity of its own input when errors already holds an entry', () => {
  const errors = ['an unrelated earlier problem'];
  const valid = validateGenresConfig([{ id: 'maze', label: 'Maze', examples: ['ex1'] }], errors);

  assert.equal(valid, true);
  assert.deepEqual(errors, ['an unrelated earlier problem']);
});
