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

/** Contents of `config/reaction-config.json`, as the pipeline reads it. */
export interface ReactionConfig {
  /** Reaction store REST endpoint, or null when none is configured. */
  endpointUrl: string | null;
  /** The public, insert-only key that ships in the page. */
  anonKey: string | null;
}
