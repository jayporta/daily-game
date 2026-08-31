import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGenresConfig } from '../genres.ts';

test('validateGenresConfig accepts a valid config', () => {
  const result = validateGenresConfig([{ id: 'maze', label: 'Maze', examples: ['ex1', 'ex2'] }]);
  assert.equal(result.valid, true);
});

test('validateGenresConfig rejects duplicate ids', () => {
  const result = validateGenresConfig([
    { id: 'maze', label: 'Maze', examples: ['ex1'] },
    { id: 'maze', label: 'Maze Again', examples: ['ex2'] },
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('duplicated')));
});

test('validateGenresConfig rejects empty examples array entries', () => {
  const result = validateGenresConfig([{ id: 'maze', label: 'Maze', examples: [] }]);
  assert.equal(result.valid, false);
});
