// Countdown formatting for the "will be replaced in ..." label. Pure, so the
// display logic is testable without rendering or fake timers.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Milliseconds until the current game is replaced, clamped at zero.
 *
 * @param expiresAt ISO timestamp from the manifest; an unparseable value
 *   is treated as already expired rather than throwing.
 * @param now Injectable clock, so tests need no fake timers.
 */
export function msUntil(expiresAt: string, now: number = Date.now()): number {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return 0;
  return Math.max(0, expiry - now);
}

/**
 * Coarse at a distance, precise near the end: hours and minutes while
 * there's an hour or more left, minutes and seconds below that.
 *
 * @param remainingMs Output of {@link msUntil}.
 */
export function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return 'any moment now';

  const hours = Math.floor(remainingMs / HOUR);
  const minutes = Math.floor((remainingMs % HOUR) / MINUTE);
  const seconds = Math.floor((remainingMs % MINUTE) / SECOND);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Formats a timestamp as e.g. "8/29/26".
 *
 * @param isoDate ISO timestamp; rendered in UTC so the label never varies
 *   by viewer timezone and tests stay stable.
 */
export function formatGeneratedDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return date.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

/**
 * How long until {@link formatCountdown} would return a different string.
 *
 * The label is coarse at a distance and precise near the end, so a caller
 * that wakes once a second spends all day recomputing a string that reads
 * the same 59 times out of 60. Waking on the label's own granularity shows
 * the same label at every instant for a fraction of the wakeups.
 *
 * The first wait after a granularity change only aligns to the boundary, so
 * it can land on the same label — every wait after it changes one.
 *
 * @param remainingMs Output of {@link msUntil}.
 * @returns Milliseconds to wait, or `0` once the label has reached "any
 *   moment now" and can never change again.
 */
export function msUntilLabelChanges(remainingMs: number): number {
  if (remainingMs <= 0) return 0;
  // Matches formatCountdown's own `hours > 0` boundary: at or above an hour
  // the label carries minutes, below it seconds.
  const step = remainingMs >= HOUR ? MINUTE : SECOND;
  return remainingMs % step || step;
}
