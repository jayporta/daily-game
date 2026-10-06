// The day arithmetic the pipeline does, in one place: calendar dates, and the
// publishing slot a run belongs to.
//
// Everything here is UTC. The repo's crons have no timezone concept, the
// history file is keyed by UTC date, and a local-time reading of "today"
// would name a different day for part of every evening.
/** One day in milliseconds. */
export const MS_PER_DAY = 86_400_000;

/**
 * The UTC calendar date of `now`, as `YYYY-MM-DD`.
 *
 * The form every `history/games.json` entry is keyed by and every slug
 * begins with.
 */
export function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The time of day, in UTC, a daily cron fires at. */
export interface DailyCron {
  readonly hour: number;
  readonly minute: number;
}

/**
 * A daily `M H * * *` cron's time of day.
 *
 * @returns `null` for any other shape, including a minute outside 0-59 or an
 * hour outside 0-23, so a caller can degrade rather than throw.
 */
export function parseDailyCron(cronSchedule: string): DailyCron | null {
  const [minuteField, hourField, ...rest] = cronSchedule.trim().split(/\s+/);
  if (rest.length !== 3 || rest.some((field) => field !== '*')) return null;
  if (!/^\d+$/.test(minuteField ?? '') || !/^\d+$/.test(hourField ?? '')) return null;

  const minute = Number(minuteField);
  const hour = Number(hourField);
  return minute <= 59 && hour <= 23 ? { hour, minute } : null;
}

/** How early a run may arrive and still claim the slot about to open. */
export const SLOT_LEAD_MS = 5 * 60 * 1000;

/**
 * The tick of `cronSchedule` that opened the publishing slot `now` belongs to:
 * the most recent one at or before `now` plus {@link SLOT_LEAD_MS}.
 *
 * @returns `null` for a schedule {@link parseDailyCron} cannot read.
 */
export function slotStart(cronSchedule: string, now: Date): Date | null {
  const daily = parseDailyCron(cronSchedule);
  if (daily === null) return null;

  const claimed = new Date(now.getTime() + SLOT_LEAD_MS);
  const tick = Date.UTC(
    claimed.getUTCFullYear(),
    claimed.getUTCMonth(),
    claimed.getUTCDate(),
    daily.hour,
    daily.minute,
  );
  return new Date(tick > claimed.getTime() ? tick - MS_PER_DAY : tick);
}

/**
 * The UTC date of the publishing slot `now` belongs to, as `YYYY-MM-DD`.
 *
 * A fallback run deferred past midnight UTC therefore still belongs to the day
 * before. Falls back to {@link isoDate} for a schedule that is not plain daily.
 */
export function gameDate(cronSchedule: string, now: Date): string {
  return isoDate(slotStart(cronSchedule, now) ?? now);
}
