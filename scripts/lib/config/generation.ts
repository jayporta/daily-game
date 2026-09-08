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
   * How old an entry may get before a rollup archives it.
   *
   * The cutoff a rollup applies, not an unconditional bound on the file:
   * `rollupTriggerEntries` decides whether a rollup runs at all, so entries
   * older than this stay in the hot window until that count is exceeded.
   * Nothing is lost when one does age out — an archived entry still counts
   * toward the summary's tallies.
   */
  historyHotWindowDays: number;
  /**
   * How many entries the hot window must exceed before a rollup runs at all.
   *
   * A count, checked before the age cutoff, so a short window of old entries
   * is left alone. Compaction is maintenance; it should not be something
   * every run pays for.
   */
  rollupTriggerEntries: number;
  /**
   * The chance, per run, of even considering a successor to a popular past
   * game rather than something new. Rolled once, outside the retry loop.
   *
   * The gate, not the outcome: a successful roll still offers nothing when no
   * game on the leaderboard falls inside `remixLookbackDays`.
   */
  remixProbability: number;
  /** How far back, in days, a remix may reach for its subject. */
  remixLookbackDays: number;
  /**
   * The model's sampling temperature for each attempt, in order.
   *
   * Index 0 is the first attempt, index 1 the second. Low keeps the model on
   * its most probable wording, which is what following the two-block output
   * contract asks for; higher samples more widely. Rising values therefore
   * start strict and loosen, so a retry is not a near-copy of the answer that
   * just failed.
   *
   * The last value repeats once the list is shorter than the number of
   * attempts, so every attempt past the end runs at the ceiling. A run makes
   * one attempt per active model, or `MAX_ATTEMPTS` when a model is forced.
   */
  retryTemperatures: number[];
  /**
   * Where errors are reported, or `null` to report none.
   *
   * The one copy of the DSN: `publish.ts` reads it for the snippet it appends
   * to every published bundle, and `vite.config.ts` inlines it for the page.
   * `null` makes both no-ops, so a fork runs without one.
   */
  sentryDsn: string | null;
  /**
   * When the game is due, and the single source of truth for that.
   *
   * Drives the front-end countdown via `computeExpiresAt`, and is the time the
   * external trigger that dispatches the workflow is set to. Actions cannot
   * read config, so the schedule in `generate-daily-game.yml` is a separate
   * value on purpose — a later fallback, not a copy of this one. Change this
   * and the external trigger together; leave the workflow's cron alone unless
   * the fallback delay itself is what is changing.
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
