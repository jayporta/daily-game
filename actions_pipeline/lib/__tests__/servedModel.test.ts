import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  failedOverModels,
  resolveServedModel,
  servedModel,
} from '#actions_pipeline/lib/servedModel.ts';

test('servedModel reads the top-level model field', () => {
  assert.equal(servedModel({ model: 'a/model:free', choices: [] }), 'a/model:free');
});

test('servedModel is null when the frame names no model', () => {
  assert.equal(servedModel({ choices: [] }), null);
  assert.equal(servedModel({ model: 7 }), null);
  assert.equal(servedModel(null), null);
});

// An empty id names nothing, and `readStream` keeps looking only past a null.
test('servedModel is null for an empty model, so a later frame can still name one', () => {
  assert.equal(servedModel({ model: '' }), null);
});

test('failedOverModels lists the requested models ahead of the one that served', () => {
  assert.deepEqual(failedOverModels('c/third', 'a/primary', ['b/second', 'c/third']), [
    'a/primary',
    'b/second',
  ]);
  assert.deepEqual(failedOverModels('a/primary', 'a/primary', ['b/second']), []);
});

test('failedOverModels is empty for an id that was not requested', () => {
  assert.deepEqual(failedOverModels('z/other', 'a/primary', ['b/second']), []);
});

test('resolveServedModel matches an id exactly', () => {
  assert.equal(
    resolveServedModel('b/second:free', 'a/primary:free', ['b/second:free']),
    'b/second:free',
  );
});

test('resolveServedModel matches when the provider drops the :free suffix', () => {
  assert.equal(
    resolveServedModel('b/second', 'a/primary:free', ['b/second:free']),
    'b/second:free',
  );
});

test('resolveServedModel matches when the provider adds a variant suffix', () => {
  assert.equal(resolveServedModel('b/second:free', 'a/primary', ['b/second']), 'b/second');
});

// A wrong attribution would credit a failure or a success to a model that
// never ran; the primary is the honest default when nothing matches.
test('resolveServedModel falls back to the primary for an id it cannot match', () => {
  assert.equal(
    resolveServedModel('b/second-20260101', 'a/primary:free', ['b/second:free']),
    'a/primary:free',
  );
});

test('resolveServedModel falls back to the primary when no frame named a model', () => {
  assert.equal(resolveServedModel(null, 'a/primary:free', ['b/second:free']), 'a/primary:free');
});
