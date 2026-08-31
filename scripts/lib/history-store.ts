// Read/append/write for the two history files. Centralised here because
// publish.ts, rollup-history.ts and fetch-feedback.ts all touch the same
// files and must agree on their shape and formatting.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './paths.ts';
import {
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
  isRecordOf,
  loadValidatedJson,
  type ValidationResult,
} from './validation.ts';
import type { DislikeReason } from '../../lib/reaction-types.ts';

export type HistoryStatus = 'published' | 'failed_kept_previous';

/**
 * The closed set of ways one generation attempt can fail.
 *
 * Closed for the same reason {@link DislikeReason} is: the corrective wording
 * these select in `build-prompt.ts` is ours, so nothing model-authored — a
 * console message from a broken bundle, say — reaches the next prompt through
 * this path. The free-text `failureReasons` beside it stay for humans reading
 * `history/games.md`.
 */
export const FAILURE_KINDS = [
  'generation-call',
  'extract',
  'moderation',
  'smoke-js-error',
  'smoke-network',
  'smoke-load',
] as const;

/** One of {@link FAILURE_KINDS}. */
export type FailureKind = (typeof FAILURE_KINDS)[number];

export interface HistoryGameEntry {
  date: string;
  status: HistoryStatus;
  model: string;
  slug?: string;
  genre?: string;
  theme?: string;
  mechanics?: string[];
  title?: string;
  attempts?: number;
  popularityScore?: number;
  errors?: string[];
  /**
   * What kind of failure each attempt hit, for a `failed_kept_previous` run.
   *
   * Drawn from {@link FAILURE_KINDS}, so `build-prompt.ts` can turn a
   * recurring failure into fixed guidance without quoting anything a model
   * wrote.
   */
  failureKinds?: FailureKind[];
  /**
   * Whether the published game painted anything during the smoke test's
   * settle window. A game that drew nothing still passes — several genres
   * are click-driven — but it is weak evidence of a working game.
   */
  canvasDrawn?: boolean;
  /**
   * Why each attempt failed, for a `failed_kept_previous` run.
   *
   * Recorded so the rollup can distil recurring failures into the lessons
   * note. Without it the only trace of a failed day is the attempt count,
   * and nothing downstream can learn what went wrong.
   */
  failureReasons?: string[];
  /** Likes recorded for this game, patched in by `fetch-feedback.ts`. */
  likes?: number;
  /** Dislikes recorded for this game, patched in by `fetch-feedback.ts`. */
  dislikes?: number;
  /**
   * How often each reason was given, keyed by {@link DislikeReason}.
   *
   * Only ever counts under ids from the closed vocabulary — no string from
   * the reaction store is passed through into this file.
   */
  dislikeReasons?: Partial<Record<DislikeReason, number>>;
}

export interface PopularityEntry {
  slug: string;
  theme: string;
  mechanicsSummary: string;
  popularityScore: number;
}

export interface HistorySummary {
  genreCounts: Record<string, number>;
  genreLastUsed: Record<string, string>;
  popularityLeaderboard: PopularityEntry[];
  lessons: string;
}

export const EMPTY_SUMMARY: HistorySummary = {
  genreCounts: {},
  genreLastUsed: {},
  popularityLeaderboard: [],
  lessons: '',
};

const VALID_HISTORY_STATUSES = new Set(['published', 'failed_kept_previous']);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const FAILURE_KIND_IDS: ReadonlySet<string> = new Set(FAILURE_KINDS);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Everything wrong with one entry, each problem naming its own field.
 *
 * Checks *types*, and emptiness only where the pipeline guarantees it. That
 * line matters more than it looks: this file is written by `publish.ts` and
 * read back by the next day's run, so a rule stricter than the writer is a
 * permanent outage — `extractBundle` coerces a missing `theme`, `title` or
 * `genre` to `''`, publish commits that, and every later `readHotWindow`
 * throws on a file nothing can now repair. `model` and `slug` are exempt
 * because the pipeline fills both itself (`buildSlug` falls back to
 * `untitled`).
 *
 * Optional fields are still type-checked, because downstream readers use them
 * structurally: `renderGamesMd` and `summariseEntries` call `mechanics.join`,
 * and `build-prompt.ts` indexes `FAILURE_DIRECTIVES` by `failureKinds`.
 */
function historyGameEntryErrors(value: unknown): string[] {
  if (!isPlainObject(value)) return ['must be an object'];

  const errors: string[] = [];
  const required = (ok: boolean, message: string): void => {
    if (!ok) errors.push(message);
  };
  /** Absent is always fine; present has to be the right shape. */
  const optional = (field: unknown, ok: boolean, message: string): void => {
    if (field !== undefined && !ok) errors.push(message);
  };

  required(
    DATE_PATTERN.test(typeof value.date === 'string' ? value.date : ''),
    'date must be a YYYY-MM-DD string',
  );
  required(
    isNonEmptyString(value.status) && VALID_HISTORY_STATUSES.has(value.status),
    `status must be one of: ${[...VALID_HISTORY_STATUSES].join(', ')}`,
  );
  required(isNonEmptyString(value.model), 'model must be a non-empty string');

  if (value.status === 'published') {
    required(isNonEmptyString(value.slug), 'slug must be a non-empty string when published');
    // Present, but not necessarily non-empty — see the note above.
    required(typeof value.genre === 'string', 'genre must be a string when published');
  }

  optional(value.theme, typeof value.theme === 'string', 'theme must be a string');
  optional(value.title, typeof value.title === 'string', 'title must be a string');
  optional(value.mechanics, isStringArray(value.mechanics), 'mechanics must be an array of strings');
  optional(value.errors, isStringArray(value.errors), 'errors must be an array of strings');
  optional(
    value.failureReasons,
    isStringArray(value.failureReasons),
    'failureReasons must be an array of strings',
  );
  optional(
    value.failureKinds,
    Array.isArray(value.failureKinds) &&
      value.failureKinds.every((kind: unknown) => typeof kind === 'string' && FAILURE_KIND_IDS.has(kind)),
    `failureKinds must be an array of: ${FAILURE_KINDS.join(', ')}`,
  );
  optional(value.attempts, isFiniteNumber(value.attempts), 'attempts must be a number');
  optional(value.likes, isFiniteNumber(value.likes), 'likes must be a number');
  optional(value.dislikes, isFiniteNumber(value.dislikes), 'dislikes must be a number');
  optional(
    value.popularityScore,
    isFiniteNumber(value.popularityScore),
    'popularityScore must be a number',
  );
  optional(value.canvasDrawn, typeof value.canvasDrawn === 'boolean', 'canvasDrawn must be a boolean');
  optional(
    value.dislikeReasons,
    isRecordOf(value.dislikeReasons, isFiniteNumber),
    'dislikeReasons must be an object whose values are numbers',
  );

  return errors;
}

/**
 * Whether one value is a usable entry.
 *
 * Shares {@link historyGameEntryErrors} with {@link validateHistoryGames} so
 * the hot window and the archive can never disagree about what an entry is —
 * `rollup-history.ts` reads lines this file's writer produced, but a hand-edit
 * or a half-written line has to be caught rather than cast.
 */
export function isHistoryGameEntry(value: unknown): value is HistoryGameEntry {
  return historyGameEntryErrors(value).length === 0;
}

/** Rules for `history/games.json` — the hot window {@link readHotWindow} reads. */
export function validateHistoryGames(json: unknown): ValidationResult {
  if (!Array.isArray(json)) {
    return { valid: false, errors: ['root must be an array'] };
  }

  const errors = json.flatMap((entry: unknown, i: number) => {
    if (!isPlainObject(entry)) return [`games[${i}] must be an object`];
    return historyGameEntryErrors(entry).map((error) => `games[${i}].${error}`);
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Rules for `history/summary.json`.
 *
 * Every field is optional: {@link readSummary} fills a missing one from
 * {@link EMPTY_SUMMARY}. A field that is present must carry the right type,
 * since it is spread over the defaults and reaches the prompt builder
 * unchecked.
 */
export function validateHistorySummary(json: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(json)) {
    return { valid: false, errors: ['root must be an object'] };
  }

  if (json.genreCounts !== undefined && !isRecordOf(json.genreCounts, isFiniteNumber)) {
    errors.push('genreCounts must be an object whose values are numbers');
  }
  if (json.genreLastUsed !== undefined && !isRecordOf(json.genreLastUsed, isNonEmptyString)) {
    errors.push('genreLastUsed must be an object whose values are date strings');
  }
  if (json.lessons !== undefined && typeof json.lessons !== 'string') {
    errors.push('lessons must be a string');
  }

  if (json.popularityLeaderboard !== undefined) {
    if (!Array.isArray(json.popularityLeaderboard)) {
      errors.push('popularityLeaderboard must be an array');
    } else {
      json.popularityLeaderboard.forEach((entry: unknown, i: number) => {
        const at = `popularityLeaderboard[${i}]`;
        if (!isPlainObject(entry)) {
          errors.push(`${at} must be an object`);
          return;
        }
        // Each is sliced or interpolated into the prompt, so all must be strings.
        if (!isNonEmptyString(entry.slug)) errors.push(`${at}.slug must be a non-empty string`);
        if (!isNonEmptyString(entry.theme)) errors.push(`${at}.theme must be a non-empty string`);
        if (!isNonEmptyString(entry.mechanicsSummary)) {
          errors.push(`${at}.mechanicsSummary must be a non-empty string`);
        }
        if (!isFiniteNumber(entry.popularityScore)) {
          errors.push(`${at}.popularityScore must be a number`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

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
      for (const reason of entry.failureReasons ?? []) lines.push(`- ${reason}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function writeGamesMd(filePath: string, entries: HistoryGameEntry[]): void {
  writeFileEnsuringDir(filePath, renderGamesMd(entries));
}
