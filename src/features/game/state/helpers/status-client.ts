// Fetching what the last run had to say for itself, and deciding whether it
// still applies. Kept free of React so it can be unit tested with a stubbed
// fetch; the shape guard lives with its type in lib/status.ts, since the
// pipeline writes the same file.

import { isRunStatus, type RunStatus } from '#lib/status.ts';
import type { FetchOptions } from '#src/features/game/state/helpers/manifest-client.ts';

/**
 * Cache-busted for the same reason the manifest is: it is rewritten in place
 * whenever a run has something new to report.
 */
export function runStatusUrl(now: number = Date.now()): string {
  return `status.json?t=${now}`;
}

/**
 * The published run status, or `null` when the pipeline published none.
 *
 * A 404 is the ordinary case, not a failure: most days have nothing to
 * report, so no file is written at all.
 *
 * @throws If the file exists but cannot be read or does not match its shape,
 *   which the caller reports and then carries on without.
 */
export async function fetchRunStatus({
  fetchImpl = fetch,
  now = Date.now(),
}: FetchOptions = {}): Promise<RunStatus | null> {
  const response = await fetchImpl(runStatusUrl(now), { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`could not load run status (${response.status})`);
  }
  const parsed: unknown = await response.json();
  if (!isRunStatus(parsed)) {
    throw new Error('run status did not match its shape');
  }
  return parsed;
}

/**
 * Whether the retry a status promised has already fallen due.
 *
 * An unusable timestamp counts as past, so a status the page cannot place in
 * time is dropped rather than shown forever.
 *
 * @param now Epoch milliseconds.
 */
export function isRetryTimePast(status: RunStatus, now: number): boolean {
  const retryAt = Date.parse(status.retryAt);
  return Number.isNaN(retryAt) || now >= retryAt;
}

/**
 * Whether a status describes a run later than the game currently on screen.
 *
 * @remarks
 * One of the two ways a status stops applying, and the reason nothing has to
 * delete the file: a game published since settles it.
 *
 * @param gameDate The `date` of the manifest being shown, `YYYY-MM-DD`.
 */
export function isNewerThanGame(status: RunStatus, gameDate: string): boolean {
  return status.date > gameDate;
}
