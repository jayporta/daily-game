// The day arithmetic the pipeline does, in one place.
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
