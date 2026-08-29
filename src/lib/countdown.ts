// Countdown formatting for the "replaced in ..." label. Pure, so the
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
 * Formats a timestamp as e.g. "Aug 29, 2026".
 *
 * @param isoDate ISO timestamp; rendered in UTC so the label never varies
 *   by viewer timezone and tests stay stable.
 */
export function formatGeneratedDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
