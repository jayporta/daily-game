import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BYOK_PROVIDERS, isByokModelsConfig, isByokProvider } from '#lib/byok-config-types.ts';

const VALID = [
  { provider: 'openrouter', label: 'OpenRouter', models: [{ id: 'a/model:free', label: 'A' }] },
];

test('isByokModelsConfig accepts a well-formed catalogue', () => {
  assert.equal(isByokModelsConfig(VALID), true);
});

test('isByokModelsConfig accepts an empty catalogue', () => {
  assert.equal(isByokModelsConfig([]), true);
});

test('isByokModelsConfig rejects a non-array root', () => {
  for (const value of [null, undefined, {}, 'openrouter', 42]) {
    assert.equal(isByokModelsConfig(value), false, `${JSON.stringify(value)} was accepted`);
  }
});

test('isByokModelsConfig rejects an unknown provider id', () => {
  assert.equal(
    isByokModelsConfig([{ provider: 'made-up', label: 'X', models: [{ id: 'a', label: 'A' }] }]),
    false,
  );
});

test('isByokModelsConfig rejects a provider entry missing a field', () => {
  assert.equal(isByokModelsConfig([{ provider: 'openrouter', models: [] }]), false);
});

test('isByokModelsConfig rejects an empty models array', () => {
  assert.equal(
    isByokModelsConfig([{ provider: 'openrouter', label: 'OpenRouter', models: [] }]),
    false,
  );
});

test('isByokModelsConfig rejects a model entry missing a field', () => {
  assert.equal(
    isByokModelsConfig([{ provider: 'openrouter', label: 'OpenRouter', models: [{ id: 'a' }] }]),
    false,
  );
});

test('isByokProvider accepts every id in BYOK_PROVIDERS', () => {
  for (const provider of BYOK_PROVIDERS) {
    assert.equal(isByokProvider(provider), true, `${provider} was rejected`);
  }
});

test('isByokProvider rejects an id outside the vocabulary', () => {
  assert.equal(isByokProvider('made-up'), false);
});

test('isByokProvider rejects values that are not strings', () => {
  for (const value of [null, undefined, 42, {}, ['openrouter']]) {
    assert.equal(isByokProvider(value), false, `${JSON.stringify(value)} was accepted`);
  }
});
