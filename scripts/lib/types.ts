// Node-only shapes: config files and the history store. Kept separate
// from lib/types.ts (isomorphic bundle types) since these never need to
// ship to the browser.
import type { DislikeReason } from '../../lib/reaction-types.ts';

export interface ModelEntry {
  id: string;
  active: boolean;
  provider: string;
}

export interface ModelsConfig {
  moderationModel: string;
  models: ModelEntry[];
}

export interface GenreEntry {
  id: string;
  label: string;
  examples: string[];
}

export type GenresConfig = GenreEntry[];

export interface GenerationConfig {
  historyHotWindowDays: number;
  rollupTriggerEntries: number;
  remixProbability: number;
  remixLookbackDays: number;
  retryTemperatures: number[];
  sentryDsn: string | null;
  cronSchedule: string;
}

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

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
