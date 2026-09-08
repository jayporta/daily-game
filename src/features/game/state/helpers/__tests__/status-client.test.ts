import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchRunStatus,
  isNewerThanGame,
  isRetryTimePast,
  runStatusUrl,
} from '#src/features/game/state/helpers/status-client.ts';
import { jsonResponse, MANIFEST, RUN_STATUS } from '#src/lib/testFixtures.ts';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');

/** A fetch answering every request with one response. */
function stub(response: Response): typeof fetch {
  return async () => response;
}

test('runStatusUrl busts the cache, since the file is rewritten in place', () => {
  assert.equal(runStatusUrl(1234), 'status.json?t=1234');
});

test('fetchRunStatus returns a published status', async () => {
  const status = await fetchRunStatus({ fetchImpl: stub(jsonResponse(RUN_STATUS)), now: NOW });

  assert.deepEqual(status, RUN_STATUS);
});

// Most days have nothing to report, so no file is written at all.
test('fetchRunStatus treats a missing file as nothing to report', async () => {
  const status = await fetchRunStatus({
    fetchImpl: stub(new Response('', { status: 404 })),
    now: NOW,
  });

  assert.equal(status, null);
});

test('fetchRunStatus throws when the file exists but cannot be read', async () => {
  await assert.rejects(
    () => fetchRunStatus({ fetchImpl: stub(new Response('', { status: 500 })), now: NOW }),
    /could not load run status \(500\)/,
  );
});

test('fetchRunStatus throws on a status that does not match its shape', async () => {
  await assert.rejects(
    () => fetchRunStatus({ fetchImpl: stub(jsonResponse({ date: '2026-08-30' })), now: NOW }),
    /did not match its shape/,
  );
});

// The first of the two ways a status stops applying.
test('a status describes a newer run than the game on screen', () => {
  assert.equal(isNewerThanGame(RUN_STATUS, MANIFEST.date), true);
});

test('a status no newer than the game on screen has been overtaken', () => {
  assert.equal(isNewerThanGame(RUN_STATUS, '2026-08-30'), false);
});

// The second, and the reason nothing ever has to delete the file.
test('a retry time still ahead has not fallen due', () => {
  assert.equal(isRetryTimePast(RUN_STATUS, NOW), false);
});

test('a retry time that has arrived counts as due', () => {
  assert.equal(isRetryTimePast(RUN_STATUS, Date.parse('2026-08-31T00:00:00.000Z')), true);
});

// Shown forever is the worse failure, so an unplaceable status is dropped.
test('a retry time that cannot be read counts as due', () => {
  assert.equal(isRetryTimePast({ ...RUN_STATUS, retryAt: 'not-a-date' }, NOW), true);
});
