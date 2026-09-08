// What the last run has to say for itself when it produced no game. Written by
// publish.ts, read by the page in place of the countdown.
//
// In lib/ because both build targets compile it, so the writer and the reader
// cannot drift apart. Kept separate from manifest.json on purpose: that file
// describes the game being served and must stay untouched by a failed run.
import { isRecord } from '#lib/guards.ts';

/**
 * The one failure worth telling a visitor about: no retry today can fix it,
 * so the honest thing to show is when to come back.
 */
export const QUOTA_EXCEEDED = 'quota-exceeded';

export interface RunStatus {
  /** The day the failed run belongs to, `YYYY-MM-DD`. */
  readonly date: string;
  /** Why no game arrived. */
  readonly state: typeof QUOTA_EXCEEDED;
  /**
   * ISO timestamp of the next scheduled run. Readers stop honouring the
   * status once that moment passes, so one left behind by a run that never
   * repeated ages out without anything having to delete it.
   */
  readonly retryAt: string;
}

/**
 * Full shape check, because this is fetched over the network like any other
 * published file and a partial one would render a message about nothing.
 *
 * @param value Parsed JSON of unknown shape.
 */
export function isRunStatus(value: unknown): value is RunStatus {
  if (!isRecord(value)) return false;
  return (
    typeof value['date'] === 'string' &&
    typeof value['retryAt'] === 'string' &&
    value['state'] === QUOTA_EXCEEDED
  );
}
