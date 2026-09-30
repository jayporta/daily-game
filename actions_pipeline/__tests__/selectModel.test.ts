import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelsConfig } from '#actions_pipeline/lib/config/models.ts';
import {
  activeModels,
  fallbackModelsAfter,
  selectNextModel,
} from '#actions_pipeline/selectModel.ts';

const CONFIG: ModelsConfig = {
  moderationModel: 'mod/model:free',
  models: [
    { id: 'a/model:free', active: true, provider: 'openrouter' },
    { id: 'disabled/model:free', active: false, provider: 'openrouter' },
    { id: 'b/model:free', active: true, provider: 'openrouter' },
    { id: 'c/model:free', active: true, provider: 'openrouter' },
  ],
};

test('activeModels skips disabled entries', () => {
  assert.deepEqual(
    activeModels(CONFIG).map((m) => m.id),
    ['a/model:free', 'b/model:free', 'c/model:free'],
  );
});

test('selects the first active model when there is no last-used id', () => {
  assert.equal(selectNextModel(CONFIG).id, 'a/model:free');
});

test('advances round-robin through active models', () => {
  assert.equal(selectNextModel(CONFIG, 'a/model:free').id, 'b/model:free');
  assert.equal(selectNextModel(CONFIG, 'b/model:free').id, 'c/model:free');
});

test('wraps around at the end of the rotation', () => {
  assert.equal(selectNextModel(CONFIG, 'c/model:free').id, 'a/model:free');
});

// Both are ids absent from the active rotation.
for (const [scenario, lastUsed] of [
  ['switched off', 'disabled/model:free'],
  ['removed from the file', 'gone/model:free'],
] as const) {
  test(`restarts the rotation when the last-used model was ${scenario}`, () => {
    assert.equal(selectNextModel(CONFIG, lastUsed).id, 'a/model:free');
  });
}

test('throws when no model is active', () => {
  const noneActive: ModelsConfig = {
    moderationModel: 'mod/model:free',
    models: [{ id: 'a/model:free', active: false, provider: 'openrouter' }],
  };
  assert.throws(() => selectNextModel(noneActive), /no entries with active: true/);
});

/** A rotation of `size` active models named `m0` .. `m{size-1}`. */
function rotationOf(size: number): ModelsConfig {
  return {
    moderationModel: 'mod/model:free',
    models: Array.from({ length: size }, (_, index) => ({
      id: `m${index}`,
      active: true,
      provider: 'openrouter' as const,
    })),
  };
}

// The list can never hold the primary or a repeat, however small the rotation:
// a request naming the same model twice would just retry it.
for (const [size, expected] of [
  [1, []],
  [2, ['m1']],
  [3, ['m1', 'm2']],
  [7, ['m1', 'm2']],
] as const) {
  test(`a rotation of ${size} yields ${expected.length} fallback(s) after the first`, () => {
    assert.deepEqual(fallbackModelsAfter(rotationOf(size), 'm0', 2), expected);
  });
}

test('fallbacks wrap around the end of the rotation', () => {
  assert.deepEqual(fallbackModelsAfter(rotationOf(4), 'm3', 2), ['m0', 'm1']);
});

test('fallbacks skip disabled entries', () => {
  assert.deepEqual(fallbackModelsAfter(CONFIG, 'a/model:free', 2), [
    'b/model:free',
    'c/model:free',
  ]);
});

test('a primary outside the rotation gets fallbacks from its start', () => {
  assert.deepEqual(fallbackModelsAfter(CONFIG, 'gone/model:free', 2), [
    'a/model:free',
    'b/model:free',
  ]);
});

test('a count of zero yields no fallbacks', () => {
  assert.deepEqual(fallbackModelsAfter(rotationOf(3), 'm0', 0), []);
});

test('fallbacks walk past skipped ids without listing them', () => {
  assert.deepEqual(fallbackModelsAfter(rotationOf(5), 'm0', 2, new Set(['m1', 'm3'])), [
    'm2',
    'm4',
  ]);
});

test('skipped ids shrink the list when too few others remain', () => {
  assert.deepEqual(fallbackModelsAfter(rotationOf(4), 'm0', 2, new Set(['m1', 'm2'])), ['m3']);
});

test('a walk whose every id is skipped yields nothing, even from a primary outside the rotation', () => {
  assert.deepEqual(fallbackModelsAfter(rotationOf(3), 'gone', 2, new Set(['m0', 'm1', 'm2'])), []);
});
