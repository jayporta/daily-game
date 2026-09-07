import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateModelsConfig } from '#scripts/lib/config/models.ts';

test('validateModelsConfig accepts a valid config', () => {
  const result = validateModelsConfig({
    moderationModel: 'mistralai/mistral-7b-instruct:free',
    models: [
      { id: 'a/model:free', active: true, provider: 'openrouter' },
      { id: 'b/model:free', active: false, provider: 'openrouter' },
    ],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateModelsConfig rejects missing moderationModel', () => {
  const result = validateModelsConfig({
    models: [{ id: 'a', active: true, provider: 'openrouter' }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('moderationModel')));
});

test('validateModelsConfig rejects when no model is active', () => {
  const result = validateModelsConfig({
    moderationModel: 'm',
    models: [{ id: 'a', active: false, provider: 'openrouter' }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('at least one entry with active: true')));
});

test('validateModelsConfig rejects a moderation model that is also in the active rotation', () => {
  const result = validateModelsConfig({
    moderationModel: 'a/model:free',
    models: [{ id: 'a/model:free', active: true, provider: 'openrouter' }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('must not also be an active entry')));
});

test('validateModelsConfig allows a moderation model listed as an inactive entry', () => {
  const result = validateModelsConfig({
    moderationModel: 'b/model:free',
    models: [
      { id: 'a/model:free', active: true, provider: 'openrouter' },
      { id: 'b/model:free', active: false, provider: 'openrouter' },
    ],
  });
  assert.equal(result.valid, true);
});

test('validateModelsConfig rejects wrong-typed active field', () => {
  const result = validateModelsConfig({
    moderationModel: 'm',
    models: [{ id: 'a', active: 'yes', provider: 'openrouter' }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('active')));
});
