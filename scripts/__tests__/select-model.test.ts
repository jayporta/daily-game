import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeModels, selectNextModel } from '#scripts/select-model.ts';
import type { ModelsConfig } from '#scripts/lib/config/models.ts';

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
