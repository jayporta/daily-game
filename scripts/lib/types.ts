// Node-only shapes: config files and the history store. Kept separate
// from lib/types.ts (isomorphic bundle types) since these never need to
// ship to the browser.

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
