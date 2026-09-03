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
  historyHotWindowDays: number;
  rollupTriggerEntries: number;
  remixProbability: number;
  remixLookbackDays: number;
  retryTemperatures: number[];
  sentryDsn: string | null;
  /**
   * Duplicated by hand in `generate-daily-game.yml`'s `on.schedule.cron`,
   * because Actions triggers cannot read config. Change both together — this
   * copy drives the front-end countdown via `computeExpiresAt`.
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
