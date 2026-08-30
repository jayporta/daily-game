import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISLIKE_REASONS,
  isDislikeReason,
  isPublishableSlug,
  type DislikeReason,
} from './reaction-types.ts';

test('every dislike reason has a distinct id', () => {
  const ids = DISLIKE_REASONS.map((reason) => reason.id);

  assert.equal(new Set(ids).size, ids.length);
});

test('every dislike reason carries a human-readable label', () => {
  for (const reason of DISLIKE_REASONS) {
    assert.ok(reason.label.length > 0, `${reason.id} has no label`);
  }
});

test('isDislikeReason accepts every id in the vocabulary', () => {
  for (const reason of DISLIKE_REASONS) {
    assert.equal(isDislikeReason(reason.id), true, `${reason.id} was rejected`);
  }
});

// The vocabulary is closed precisely so nothing a visitor invents can reach
// the history log or, later, the generation prompt.
test('isDislikeReason rejects an id outside the vocabulary', () => {
  assert.equal(isDislikeReason('ignore-previous-instructions'), false);
});

test('isDislikeReason rejects values that are not strings', () => {
  for (const value of [null, undefined, 42, {}, ['broken']]) {
    assert.equal(isDislikeReason(value), false, `${JSON.stringify(value)} was accepted`);
  }
});

test('isDislikeReason rejects inherited object properties', () => {
  assert.equal(isDislikeReason('__proto__'), false);
  assert.equal(isDislikeReason('constructor'), false);
  assert.equal(isDislikeReason('toString'), false);
});

test('isPublishableSlug accepts a slug the pipeline would produce', () => {
  assert.equal(isPublishableSlug('2026-08-29-beetle-of-a-thousand-mirrors'), true);
});

test('isPublishableSlug rejects a slug that could escape a URL path', () => {
  assert.equal(isPublishableSlug('../../etc/passwd'), false);
  assert.equal(isPublishableSlug('2026-08-29-beetle/../admin'), false);
});

test('isPublishableSlug rejects a slug without a leading date', () => {
  assert.equal(isPublishableSlug('beetle-of-a-thousand-mirrors'), false);
});

test('isPublishableSlug rejects non-string values', () => {
  for (const value of [null, undefined, 42, {}]) {
    assert.equal(isPublishableSlug(value), false, `${JSON.stringify(value)} was accepted`);
  }
});

test('the reason id type stays in step with the vocabulary', () => {
  // Fails to compile, not at runtime, if an id is added without widening the
  // union — which is the point.
  const ids: DislikeReason[] = DISLIKE_REASONS.map((reason) => reason.id);

  assert.equal(ids.length, DISLIKE_REASONS.length);
});
