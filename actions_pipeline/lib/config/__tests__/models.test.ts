import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateModelsConfig } from '#actions_pipeline/lib/config/models.ts';

test('validateModelsConfig accepts a valid config', () => {
  const errors: string[] = [];
  const valid = validateModelsConfig(
    {
      moderationModel: 'mistralai/mistral-7b-instruct:free',
      models: [
        { id: 'a/model:free', active: true, provider: 'openrouter' },
        { id: 'b/model:free', active: false, provider: 'openrouter' },
      ],
    },
    errors,
  );
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

// The rule is file-wide, so the duplicate pair spans an active entry and an
// inactive one: a check that only walked the rotation would miss it.
test('validateModelsConfig rejects duplicate ids', () => {
  const errors: string[] = [];
  const valid = validateModelsConfig(
    {
      moderationModel: 'mistralai/mistral-7b-instruct:free',
      models: [
        { id: 'a/model:free', active: true, provider: 'openrouter' },
        { id: 'a/model:free', active: false, provider: 'openrouter' },
      ],
    },
    errors,
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('duplicated')));
});

test('validateModelsConfig rejects missing moderationModel', () => {
  const errors: string[] = [];
  const valid = validateModelsConfig(
    {
      models: [{ id: 'a', active: true, provider: 'openrouter' }],
    },
    errors,
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('moderationModel')));
});

test('validateModelsConfig rejects when no model is active', () => {
  const errors: string[] = [];
  const valid = validateModelsConfig(
    {
      moderationModel: 'm',
      models: [{ id: 'a', active: false, provider: 'openrouter' }],
    },
    errors,
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('at least one entry with active: true')));
});

test('validateModelsConfig rejects a moderation model that is also in the active rotation', () => {
  const errors: string[] = [];
  const valid = validateModelsConfig(
    {
      moderationModel: 'a/model:free',
      models: [{ id: 'a/model:free', active: true, provider: 'openrouter' }],
    },
    errors,
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('must not also be an active entry')));
});

test('validateModelsConfig allows a moderation model listed as an inactive entry', () => {
  const errors: string[] = [];
  const valid = validateModelsConfig(
    {
      moderationModel: 'b/model:free',
      models: [
        { id: 'a/model:free', active: true, provider: 'openrouter' },
        { id: 'b/model:free', active: false, provider: 'openrouter' },
      ],
    },
    errors,
  );
  assert.equal(valid, true);
});

test('validateModelsConfig rejects wrong-typed active field', () => {
  const errors: string[] = [];
  const valid = validateModelsConfig(
    {
      moderationModel: 'm',
      models: [{ id: 'a', active: 'yes', provider: 'openrouter' }],
    },
    errors,
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('active')));
});

test('validateModelsConfig reports validity of its own input when errors already holds an entry', () => {
  const errors = ['an unrelated earlier problem'];
  const valid = validateModelsConfig(
    {
      moderationModel: 'mistralai/mistral-7b-instruct:free',
      models: [{ id: 'a/model:free', active: true, provider: 'openrouter' }],
    },
    errors,
  );

  assert.equal(valid, true);
  assert.deepEqual(errors, ['an unrelated earlier problem']);
});
