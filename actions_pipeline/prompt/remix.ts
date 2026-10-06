// The optional "spiritual successor" suggestion: picking a popular past game
// and rendering the prompt section that offers it.

import { MS_PER_DAY } from '#actions_pipeline/lib/dates.ts';
import type { HistorySummary, PopularityEntry } from '#actions_pipeline/lib/historyStore.ts';

function slugDate(slug: string): string {
  return slug.slice(0, 10);
}

function daysBetween(fromISODate: string, to: Date): number {
  const from = Date.parse(`${fromISODate}T00:00:00Z`);
  if (Number.isNaN(from)) return Number.POSITIVE_INFINITY;
  return (to.getTime() - from) / MS_PER_DAY;
}

/** Tuning and seams for {@link selectRemixSuggestion}. */
export interface RemixOptions {
  /** Chance of suggesting a remix at all, from 0 to 1. */
  remixProbability: number;
  /** How far back a game may have been published and still be a candidate, in days. */
  remixLookbackDays: number;
  /**
   * Source of the roll against `remixProbability`.
   *
   * @defaultValue `Math.random`
   */
  rng?: () => number;
  /**
   * The moment to measure `remixLookbackDays` against.
   *
   * @defaultValue the current time
   */
  now?: Date;
}

/**
 * Occasionally suggests a "spiritual successor" to a popular past game.
 * Returns null most of the time — a remix is the exception, not the rule.
 */
export function selectRemixSuggestion(
  summary: HistorySummary,
  { remixProbability, remixLookbackDays, rng = Math.random, now = new Date() }: RemixOptions,
): PopularityEntry | null {
  if (rng() >= remixProbability) return null;

  const candidates = summary.popularityLeaderboard
    .filter((entry) => daysBetween(slugDate(entry.slug), now) <= remixLookbackDays)
    .sort((a, b) => b.popularityScore - a.popularityScore);

  return candidates[0] ?? null;
}

/**
 * The prompt section offering a spiritual successor.
 *
 * @param remix - The game to suggest a successor to, from {@link selectRemixSuggestion}.
 *
 * @returns The section, or '' when no remix is suggested.
 */
export function remixSection(remix: PopularityEntry | null): string {
  if (!remix) return '';
  return `
## Optional: spiritual successor

One past game was unusually popular:
- theme: ${remix.theme}
- mechanics: ${remix.mechanicsSummary}

You MAY build a spiritual successor to it — something that captures why it
worked. If you do, it MUST differ in genre, in theme, and in at least one
core mechanic. It must never be a repeat of that game.
`;
}
