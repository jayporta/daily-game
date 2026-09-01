import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateByokModelsConfig } from '#scripts/lib/config/byokModels.ts';

const VALID_BYOK_MODELS = [
  { provider: 'openrouter', label: 'OpenRouter', models: [{ id: 'a/model:free', label: 'A' }] },
  { provider: 'anthropic', label: 'Anthropic', models: [{ id: 'claude-sonnet-5', label: 'Sonnet 5' }] },
  { provider: 'openai', label: 'OpenAI', models: [{ id: 'gpt-4o', label: 'GPT-4o' }] },
  { provider: 'gemini', label: 'Gemini', models: [{ id: 'gemini-2.5-flash', label: 'Flash' }] },
];

test('validateByokModelsConfig accepts a well-formed catalogue', () => {
  const result = validateByokModelsConfig(VALID_BYOK_MODELS);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateByokModelsConfig rejects a config missing a provider', () => {
  const result = validateByokModelsConfig(VALID_BYOK_MODELS.slice(1));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('missing provider "openrouter"')));
});

test('validateByokModelsConfig rejects a provider listed twice', () => {
  const result = validateByokModelsConfig([...VALID_BYOK_MODELS, VALID_BYOK_MODELS[0]]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('more than once')));
});

test('validateByokModelsConfig rejects an empty models array', () => {
  const result = validateByokModelsConfig([
    { provider: 'openrouter', label: 'OpenRouter', models: [] },
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('models must be a non-empty array')));
});

test('validateByokModelsConfig rejects a model with a blank id', () => {
  const result = validateByokModelsConfig([
    { provider: 'openrouter', label: 'OpenRouter', models: [{ id: '', label: 'A' }] },
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('.id must be a non-empty string')));
});

test('validateByokModelsConfig rejects a non-array root', () => {
  const result = validateByokModelsConfig({});
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['root must be an array']);
});
