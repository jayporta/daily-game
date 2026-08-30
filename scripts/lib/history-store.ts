// Read/append/write for the two history files. Centralised here because
// publish.ts, rollup-history.ts and fetch-feedback.ts all touch the same
// files and must agree on their shape and formatting.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './paths.ts';
import { validateHistoryGames, validateHistorySummary } from './schema.ts';
import { loadValidatedJson } from './config-store.ts';
import type { HistoryGameEntry, HistorySummary } from './types.ts';

export const EMPTY_SUMMARY: HistorySummary = {
  genreCounts: {},
  genreLastUsed: {},
  popularityLeaderboard: [],
  lessons: '',
};

function writeFileEnsuringDir(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

/** The hot window of full-detail entries the prompt builder reads. */
export function readHotWindow(filePath: string = paths.historyGames): HistoryGameEntry[] {
  if (!existsSync(filePath)) return [];
  return loadValidatedJson<HistoryGameEntry[]>(filePath, validateHistoryGames);
}

/**
 * The rolled-up summary, with any field the file omits filled from
 * {@link EMPTY_SUMMARY}.
 *
 * @throws If the file exists but cannot be parsed or does not validate.
 *   The contents reach the prompt builder, which iterates the leaderboard
 *   and slices dates out of its slugs.
 */
export function readSummary(filePath: string = paths.historySummary): HistorySummary {
  if (!existsSync(filePath)) return { ...EMPTY_SUMMARY };
  const parsed = loadValidatedJson<Partial<HistorySummary>>(filePath, validateHistorySummary);
  return { ...EMPTY_SUMMARY, ...parsed };
}

/**
 * Appends an entry, keeping the list sorted oldest-first and replacing any
 * existing entry for the same date (a same-day re-run supersedes, rather
 * than duplicating, its earlier attempt). Pure — returns a new array.
 */
export function appendEntry(entries: HistoryGameEntry[], newEntry: HistoryGameEntry): HistoryGameEntry[] {
  const withoutSameDate = entries.filter((entry) => entry.date !== newEntry.date);
  return [...withoutSameDate, newEntry].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Applies reaction counts to one entry, matched by slug.
 *
 * Pure and non-mutating, and a no-op when the slug is not in the hot
 * window — a game that has aged out of it must not resurrect an entry.
 *
 * @param patch Fields to overwrite. Counts replace rather than accumulate,
 *   so a re-run against the same day is idempotent.
 */
export function patchEntry(
  entries: HistoryGameEntry[],
  slug: string,
  patch: Partial<HistoryGameEntry>,
): HistoryGameEntry[] {
  return entries.map((entry) => (entry.slug === slug ? { ...entry, ...patch } : entry));
}

/** The most recent published entry, used to pick the next model in rotation. */
export function lastPublishedEntry(entries: HistoryGameEntry[]): HistoryGameEntry | undefined {
  return [...entries]
    .filter((entry) => entry.status === 'published')
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
}

export function writeGamesJson(filePath: string, entries: HistoryGameEntry[]): void {
  writeFileEnsuringDir(filePath, `${JSON.stringify(entries, null, 2)}\n`);
}

/** Human-readable mirror of the hot window. Regenerated each run, never parsed back. */
export function renderGamesMd(entries: HistoryGameEntry[]): string {
  const lines = ['# Game history', '', 'Generated automatically — do not edit by hand.', ''];

  if (entries.length === 0) {
    lines.push('_No games yet._');
    return `${lines.join('\n')}\n`;
  }

  for (const entry of [...entries].sort((a, b) => b.date.localeCompare(a.date))) {
    if (entry.status === 'published') {
      lines.push(`## ${entry.date} — ${entry.title ?? entry.slug ?? 'untitled'}`);
      lines.push('');
      lines.push(`- genre: ${entry.genre ?? 'unknown'}`);
      lines.push(`- theme: ${entry.theme ?? 'unknown'}`);
      lines.push(`- mechanics: ${entry.mechanics?.join(', ') || 'unrecorded'}`);
      lines.push(`- model: ${entry.model}`);
      if (entry.attempts !== undefined) lines.push(`- attempts: ${entry.attempts}`);
      if (entry.popularityScore !== undefined) lines.push(`- reactions: ${entry.popularityScore}`);
      if (entry.likes !== undefined) lines.push(`- likes: ${entry.likes}`);
      if (entry.dislikes !== undefined) lines.push(`- dislikes: ${entry.dislikes}`);
      const reasons = Object.entries(entry.dislikeReasons ?? {})
        .filter(([, count]) => count > 0)
        .map(([id, count]) => `${id}: ${count}`);
      if (reasons.length) lines.push(`- disliked for: ${reasons.join(', ')}`);
      if (entry.errors?.length) lines.push(`- runtime errors: ${entry.errors.length}`);
    } else {
      lines.push(`## ${entry.date} — generation failed, previous game kept`);
      lines.push('');
      lines.push(`- model: ${entry.model}`);
      if (entry.attempts !== undefined) lines.push(`- attempts: ${entry.attempts}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function writeGamesMd(filePath: string, entries: HistoryGameEntry[]): void {
  writeFileEnsuringDir(filePath, renderGamesMd(entries));
}
