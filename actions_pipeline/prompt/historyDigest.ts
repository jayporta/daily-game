// What the prompt says about past games: which genres were used lately and a
// digest of how each recent day went.

import type { HistoryGameEntry, PublishedEntry } from '#actions_pipeline/lib/historyStore.ts';
import { isObservedFailure, isPublished } from '#actions_pipeline/lib/historyStore.ts';

function publishedEntries(entries: HistoryGameEntry[]): PublishedEntry[] {
  return entries.filter(isPublished);
}

/** Most recent published entries first. */
function mostRecentFirst(entries: HistoryGameEntry[]): PublishedEntry[] {
  return [...publishedEntries(entries)].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The distinct genres of the most recently published games, newest first.
 *
 * @remarks
 * Failed days hold no genre and are skipped, so `limit` counts published
 * games rather than calendar days.
 *
 * @param entries - History entries in any order.
 * @param limit - How many published entries to look back over.
 *
 * @returns Genre ids without duplicates, most recent first.
 */
export function recentlyUsedGenreIds(entries: HistoryGameEntry[], limit = 10): string[] {
  const ids = mostRecentFirst(entries)
    .slice(0, limit)
    .map((entry) => entry.genre)
    .filter((genre) => genre.length > 0);
  return [...new Set(ids)];
}

/** How a published game was received, or '' when nothing is recorded yet. */
function reception(entry: PublishedEntry): string {
  const parts: string[] = [];
  if (entry.likes !== undefined || entry.dislikes !== undefined) {
    parts.push(`${entry.likes ?? 0} liked, ${entry.dislikes ?? 0} disliked`);
  }
  const complaints = Object.entries(entry.dislikeReasons ?? {})
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id);
  if (complaints.length > 0) parts.push(`marked: ${complaints.join(', ')}`);
  if (entry.attempts !== undefined && entry.attempts > 1) {
    parts.push(`took ${entry.attempts} attempts`);
  }
  if (entry.canvasDrawn === false) parts.push('drew nothing on screen');
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

/**
 * The recent record, with how each day actually went.
 *
 * Includes failed days as well as published ones: three broken runs in a row
 * is the most useful thing the next attempt could know, and filtering them
 * out meant the prompt never mentioned them.
 */
export function digestHistory(entries: HistoryGameEntry[], limit = 10): string {
  const recent = [...entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  if (recent.length === 0) {
    return 'No games have been published yet — you are building the very first one.';
  }

  return recent
    .map((entry) => {
      if (entry.status !== 'published') {
        const kinds = entry.failureKinds.filter(isObservedFailure).join(', ') || 'unrecorded';
        return `- ${entry.date} · FAILED after ${entry.attempts ?? '?'} attempts · ${kinds}`;
      }
      const mechanics = entry.mechanics.length > 0 ? entry.mechanics.join(', ') : 'unrecorded';
      return `- ${entry.date} · genre: ${entry.genre || 'unknown'} · theme: ${entry.theme || 'unknown'} · mechanics: ${mechanics}${reception(entry)}`;
    })
    .join('\n');
}
