// Everything about `config/generation.json`: its shape, its rules, and how
// it is read. These are the knobs on the daily run — window sizes, retry
// temperatures, the cron the countdown is computed from.
import { parseSentryDsn } from '#scripts/lib/errorReporting.ts';
import { paths } from '#scripts/lib/paths.ts';
import {
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
  loadValidatedJson,
  type ValidationResult,
} from '#scripts/lib/validation.ts';

export interface GenerationConfig {
  /**
   * Age in days past which a rollup archives a history entry.
   *
   * @remarks
   * The cutoff a rollup applies, not a bound on the file itself:
   * {@link GenerationConfig.rollupTriggerEntries} decides whether one runs.
   */
  historyHotWindowDays: number;
  /** How many entries `history/games.json` must exceed before a rollup runs. */
  rollupTriggerEntries: number;
  /**
   * Chance per run of considering a successor to a popular past game, as a
   * decimal from 0 to 1.
   *
   * @remarks
   * The gate, not the outcome. A won roll still offers nothing when no game on
   * the leaderboard falls inside {@link GenerationConfig.remixLookbackDays}.
   */
  remixProbability: number;
  /** How far back in days a remix may reach for its subject. */
  remixLookbackDays: number;
  /**
   * Sampling temperature for each attempt in order, index 0 being the first.
   *
   * @remarks
   * One entry per active model in `config/models.json`, since a run makes one
   * attempt per model. Rising values start where the two fenced output blocks
   * are most likely and loosen from there, so a retry is not a near-copy of the
   * answer that just failed. A list shorter than the run repeats its last value.
   */
  retryTemperatures: number[];
  /**
   * Where errors are reported, or `null` to report none.
   *
   * @remarks
   * The one copy of the DSN. `publish.ts` reads it for the snippet it appends
   * to every published bundle and `vite.config.ts` inlines it for the page, so
   * `null` disables both and a fork runs without one.
   */
  sentryDsn: string | null;
  /**
   * Cron expression, in UTC, for when the day's game is due.
   *
   * @remarks
   * Drives the front-end countdown through `computeExpiresAt`, and is the time
   * the external trigger that dispatches the workflow is set to. Change those
   * two together. `generate-daily-game.yml`'s own cron is a later fallback and
   * is deliberately not this value.
   *
   * @example
   * ```json
   * { "cronSchedule": "0 19 * * *" }
   * ```
   */
  cronSchedule: string;
}

export function validateGenerationConfig(json: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(json)) {
    return { valid: false, errors: ['root must be an object'] };
  }

  if (!isFiniteNumber(json.historyHotWindowDays) || json.historyHotWindowDays <= 0) {
    errors.push('historyHotWindowDays must be a positive number');
  }
  if (!isFiniteNumber(json.rollupTriggerEntries) || json.rollupTriggerEntries <= 0) {
    errors.push('rollupTriggerEntries must be a positive number');
  }
  if (
    !isFiniteNumber(json.remixProbability) ||
    json.remixProbability < 0 ||
    json.remixProbability > 1
  ) {
    errors.push('remixProbability must be a number between 0 and 1');
  }
  if (!isFiniteNumber(json.remixLookbackDays) || json.remixLookbackDays <= 0) {
    errors.push('remixLookbackDays must be a positive number');
  }
  if (
    !Array.isArray(json.retryTemperatures) ||
    json.retryTemperatures.length === 0 ||
    json.retryTemperatures.some((t: unknown) => !isFiniteNumber(t))
  ) {
    errors.push('retryTemperatures must be a non-empty array of numbers');
  }
  if (json.sentryDsn !== null) {
    // Checked for shape, not just presence: an unparseable DSN makes
    // buildErrorReportingSnippet return '', which would silently ship games
    // with no error reporting at all.
    if (!isNonEmptyString(json.sentryDsn)) {
      errors.push('sentryDsn must be null or a non-empty string');
    } else if (parseSentryDsn(json.sentryDsn) === null) {
      errors.push('sentryDsn must look like https://<publicKey>@<host>/<projectId>');
    }
  }
  if (!isNonEmptyString(json.cronSchedule)) {
    errors.push('cronSchedule must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

/** @throws If the file is missing, unparseable, or fails {@link validateGenerationConfig}. */
export function loadGenerationConfig(filePath: string = paths.generationConfig): GenerationConfig {
  return loadValidatedJson<GenerationConfig>(filePath, validateGenerationConfig);
}
