import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRunStatus, QUOTA_EXCEEDED } from '#lib/status.ts';

const VALID = { date: '2026-09-07', state: QUOTA_EXCEEDED, retryAt: '2026-09-08T19:00:00.000Z' };

test('isRunStatus accepts a complete status', () => {
  assert.equal(isRunStatus(VALID), true);
});

// Fetched over the network like any published file, so a partial one would
// otherwise render a message about nothing.
test('isRunStatus rejects a status missing any field', () => {
  for (const field of ['date', 'state', 'retryAt'] as const) {
    const { [field]: _removed, ...partial } = VALID;
    assert.equal(isRunStatus(partial), false, `${field} must be required`);
  }
});

test('isRunStatus rejects a state outside the vocabulary', () => {
  assert.equal(isRunStatus({ ...VALID, state: 'something-else' }), false);
});

test('isRunStatus rejects values that are not objects', () => {
  for (const value of [null, undefined, 'quota-exceeded', 42, []]) {
    assert.equal(isRunStatus(value), false, `${JSON.stringify(value)} must not pass`);
  }
});
