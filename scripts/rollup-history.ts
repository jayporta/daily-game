#!/usr/bin/env node
// Keeps history/games.json bounded so prompt cost stays flat as the project
// ages. Entries older than the hot window move to history/archive/, their
// genre counts and popularity fold into history/summary.json, and an AI call
// rewrites the summary's "lessons" prose.
//
// Only the prose comes from the model. Counts and the leaderboard are merged
// here in code, where they can be tested and cannot be miscounted.
//
// Nothing is deleted: an aged-out entry lives on in the monthly archive file
// and in git history.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '../lib/errors.ts';
import { loadGenerationConfig } from './lib/config-store.ts';
import {
  readHotWindow,
  readSummary,
  writeGamesJson,
  writeGamesMd,
} from './lib/history-store.ts';
import { join } from 'node:path';
import { createPaths, paths as defaultPaths, type Paths } from './lib/paths.ts';
import { validateHistorySummary } from './lib/schema.ts';
import type { GenerationConfig, HistoryGameEntry, HistorySummary, PopularityEntry } from './lib/types.ts';

const MS_PER_DAY = 86_400_000;

/**
 * How many games the leaderboard remembers. Bounded because the whole entry
 * list goes into every generation prompt verbatim.
 */
const MAX_LEADERBOARD_ENTRIES = 10;

/** Which entries stay in the hot window and which age out of it. */
export interface AgingSplit {
  /** Entries young enough to stay in `history/games.json`. */
  readonly keep: readonly HistoryGameEntry[];
  /** Entries to archive and fold into the summary, oldest first. */
  readonly aging: readonly HistoryGameEntry[];
}

/**
 * Whether there are enough entries to be worth compacting.
 *
 * Deliberately a count and not a date check: a project that skips days
 * should not roll up on the calendar alone.
 */
export function shouldRollUp(
  entries: readonly HistoryGameEntry[],
  config: Pick<GenerationConfig, 'rollupTriggerEntries'>,
): boolean {
  return entries.length > config.rollupTriggerEntries;
}

/**
 * Splits the hot window at the age cutoff.
 *
 * @param now Injectable clock, so tests need no fake timers.
 */
export function splitAging(
  entries: readonly HistoryGameEntry[],
  config: Pick<GenerationConfig, 'historyHotWindowDays'>,
  now: Date = new Date(),
): AgingSplit {
  const cutoff = now.getTime() - config.historyHotWindowDays * MS_PER_DAY;
  const keep: HistoryGameEntry[] = [];
  const aging: HistoryGameEntry[] = [];

  for (const entry of entries) {
    const at = Date.parse(`${entry.date}T00:00:00Z`);
    // An unparseable date keeps the entry: dropping a row we cannot read
    // would lose it from the hot window without archiving it.
    if (Number.isNaN(at) || at >= cutoff) {
      keep.push(entry);
    } else {
      aging.push(entry);
    }
  }

  return { keep, aging: [...aging].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** The `YYYY-MM` archive bucket an entry belongs to. */
export function archiveMonth(entry: HistoryGameEntry): string {
  return entry.date.slice(0, 7);
}

/** The summary's tallies, without the prose that {@link rewriteLessons} owns. */
export type SummaryTallies = Omit<HistorySummary, 'lessons'>;

/**
 * Tallies a set of entries from scratch.
 *
 * Derived rather than accumulated: the caller passes everything the archive
 * holds, so running a rollup twice produces the same answer instead of
 * counting a genre once per run. Pure, so the arithmetic is testable
 * without a client or a disk.
 */
export function summariseEntries(entries: readonly HistoryGameEntry[]): SummaryTallies {
  const genreCounts: Record<string, number> = {};
  const genreLastUsed: Record<string, string> = {};
  const leaderboard = new Map<string, PopularityEntry>();

  for (const entry of entries) {
    if (entry.status !== 'published' || entry.genre === undefined) continue;

    genreCounts[entry.genre] = (genreCounts[entry.genre] ?? 0) + 1;
    const lastUsed = genreLastUsed[entry.genre];
    if (lastUsed === undefined || entry.date > lastUsed) {
      genreLastUsed[entry.genre] = entry.date;
    }

    // A game nobody rated has no business on a popularity leaderboard.
    if (entry.slug === undefined || entry.popularityScore === undefined) continue;
    leaderboard.set(entry.slug, {
      slug: entry.slug,
      theme: entry.theme ?? 'unknown',
      mechanicsSummary: entry.mechanics?.join(', ') ?? 'unrecorded',
      popularityScore: entry.popularityScore,
    });
  }

  const popularityLeaderboard = [...leaderboard.values()]
    .sort((a, b) => b.popularityScore - a.popularityScore || a.slug.localeCompare(b.slug))
    .slice(0, MAX_LEADERBOARD_ENTRIES);

  return { genreCounts, genreLastUsed, popularityLeaderboard };
}

/**
 * Every entry the archive already holds.
 *
 * Unreadable lines are skipped rather than throwing: one corrupt line must
 * not stop a rollup, and the line itself is preserved on the next append.
 */
export function readArchivedEntries(paths: Paths): HistoryGameEntry[] {
  if (!existsSync(paths.historyArchiveDir)) return [];

  const entries: HistoryGameEntry[] = [];
  for (const name of readdirSync(paths.historyArchiveDir).sort()) {
    if (!name.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(paths.historyArchiveDir, name), 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === 'object' && parsed !== null && 'date' in parsed) {
          entries.push(parsed as HistoryGameEntry);
        }
      } catch {
        // Skipped, and left in place for the next append to preserve.
      }
    }
  }
  return entries;
}

/** Existing archived dates, so a re-run cannot append an entry twice. */
function archivedDates(filePath: string): Set<string> {
  if (!existsSync(filePath)) return new Set();

  const dates = new Set<string>();
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null && 'date' in parsed) {
        const { date } = parsed;
        if (typeof date === 'string') dates.add(date);
      }
    } catch {
      // An unreadable line still counts as content: it is preserved on
      // append, it just cannot take part in deduplication.
    }
  }
  return dates;
}

/**
 * Appends entries to their monthly archive files, skipping dates already
 * there.
 *
 * @returns The archive files written, relative names only.
 */
export function archiveEntries(aging: readonly HistoryGameEntry[], paths: Paths): string[] {
  const byMonth = new Map<string, HistoryGameEntry[]>();
  for (const entry of aging) {
    const month = archiveMonth(entry);
    byMonth.set(month, [...(byMonth.get(month) ?? []), entry]);
  }

  mkdirSync(paths.historyArchiveDir, { recursive: true });

  const written: string[] = [];
  for (const [month, entries] of [...byMonth.entries()].sort()) {
    const filePath = paths.historyArchiveFile(month);
    const alreadyThere = archivedDates(filePath);
    const fresh = entries.filter((entry) => !alreadyThere.has(entry.date));
    if (fresh.length === 0) continue;

    const lines = fresh.map((entry) => JSON.stringify(entry)).join('\n');
    const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(filePath, `${existing}${separator}${lines}\n`, 'utf8');
    written.push(`${month}.jsonl`);
  }
  return written;
}

/** What one rollup did. */
export interface RollupResult {
  /** False when the hot window was still under the trigger size. */
  readonly rolledUp: boolean;
  /** How many entries moved to the archive. */
  readonly archived: number;
  /** How many stayed in the hot window. */
  readonly kept: number;
  /** Archive files touched, e.g. `['2026-07.jsonl']`. */
  readonly files: readonly string[];
}

export interface RollUpHistoryOptions {
  generationConfig?: GenerationConfig;
  /** Repo root to read and write — overridden in tests. */
  root?: string;
  now?: Date;
  /** Compute everything, write nothing. */
  dryRun?: boolean;
}

/**
 * Compacts the hot window, if it has grown past the trigger.
 *
 * Deterministic and makes no model call: the tallies derive from the archive
 * and the lessons note is carried through for `reflect-lessons.ts` to own.
 * Writes go archive → summary → hot window, so an interruption leaves entries
 * duplicated rather than lost.
 */
export async function rollUpHistory({
  generationConfig,
  root,
  now = new Date(),
  dryRun = false,
}: RollUpHistoryOptions = {}): Promise<RollupResult> {
  const paths = root ? createPaths(root) : defaultPaths;
  const config = generationConfig ?? loadGenerationConfig(paths.generationConfig);
  const entries = readHotWindow(paths.historyGames);

  if (!shouldRollUp(entries, config)) {
    return { rolledUp: false, archived: 0, kept: entries.length, files: [] };
  }

  const { keep, aging } = splitAging(entries, config, now);
  if (aging.length === 0) {
    return { rolledUp: false, archived: 0, kept: entries.length, files: [] };
  }

  const summary = readSummary(paths.historySummary);

  // What the archive will hold once this run appends to it. Computed before
  // the write so a dry run sees the same answer, and derived from the whole
  // archive so a repeated run cannot double-count.
  const archived = readArchivedEntries(paths);
  const archivedDates = new Set(archived.map((entry) => entry.date));
  const tallies = summariseEntries([
    ...archived,
    ...aging.filter((entry) => !archivedDates.has(entry.date)),
  ]);

  // The note itself belongs to reflect-lessons.ts, which rewrites it daily
  // from the hot window. Carried through untouched here.
  const updated: HistorySummary = { ...tallies, lessons: summary.lessons };

  const validation = validateHistorySummary(updated);
  if (!validation.valid) {
    throw new Error(`rollup produced an invalid summary — ${validation.errors.join('; ')}`);
  }

  if (dryRun) {
    return {
      rolledUp: true,
      archived: aging.length,
      kept: keep.length,
      files: [],
    };
  }

  const files = archiveEntries(aging, paths);
  writeFileSync(paths.historySummary, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  writeGamesJson(paths.historyGames, [...keep]);
  writeGamesMd(paths.historyGamesMd, [...keep]);

  return {
    rolledUp: true,
    archived: aging.length,
    kept: keep.length,
    files,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  rollUpHistory({ dryRun })
    .then((result) => {
      if (!result.rolledUp) {
        const plural = result.kept === 1 ? 'entry' : 'entries';
        console.log(`Hot window is ${result.kept} ${plural} — under the trigger, nothing to do.`);
        return;
      }
      const prefix = dryRun ? '[dry-run] ' : '';
      console.log(
        `${prefix}Archived ${result.archived} entries into ${result.files.join(', ') || 'no files'}, ` +
          `kept ${result.kept}.`,
      );
    })
    .catch((error: unknown) => {
      console.error(`Rollup failed: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
}
