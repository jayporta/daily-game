// Hand-written config/history validators. Deliberately not a generic
// JSON-Schema engine — these are small, specific, and easy to read without
// adding a dependency. Each takes `unknown` (the direct result of
// JSON.parse) since the whole point is validating input we don't yet
// trust matches scripts/lib/types.ts's shapes.
import type { ValidationResult } from './types.ts';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateModelsConfig(json: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(json)) {
    return { valid: false, errors: ['root must be an object'] };
  }

  if (!isNonEmptyString(json.moderationModel)) {
    errors.push('moderationModel must be a non-empty string');
  }

  if (!Array.isArray(json.models)) {
    errors.push('models must be an array');
  } else {
    if (json.models.length === 0) errors.push('models must not be empty');
    json.models.forEach((entry: unknown, i: number) => {
      if (!isPlainObject(entry)) {
        errors.push(`models[${i}] must be an object`);
        return;
      }
      if (!isNonEmptyString(entry.id)) errors.push(`models[${i}].id must be a non-empty string`);
      if (typeof entry.active !== 'boolean') errors.push(`models[${i}].active must be a boolean`);
      if (!isNonEmptyString(entry.provider)) errors.push(`models[${i}].provider must be a non-empty string`);
    });
    const hasActiveModel = json.models.some(
      (m: unknown) => isPlainObject(m) && m.active === true,
    );
    if (!hasActiveModel) {
      errors.push('models must contain at least one entry with active: true');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateGenresConfig(json: unknown): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(json)) {
    return { valid: false, errors: ['root must be an array'] };
  }
  if (json.length === 0) errors.push('genres must not be empty');

  const seenIds = new Set<string>();
  json.forEach((entry: unknown, i: number) => {
    if (!isPlainObject(entry)) {
      errors.push(`genres[${i}] must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.id)) {
      errors.push(`genres[${i}].id must be a non-empty string`);
    } else if (seenIds.has(entry.id)) {
      errors.push(`genres[${i}].id "${entry.id}" is duplicated`);
    } else {
      seenIds.add(entry.id);
    }
    if (!isNonEmptyString(entry.label)) errors.push(`genres[${i}].label must be a non-empty string`);
    if (
      !Array.isArray(entry.examples) ||
      entry.examples.length === 0 ||
      entry.examples.some((e: unknown) => !isNonEmptyString(e))
    ) {
      errors.push(`genres[${i}].examples must be a non-empty array of non-empty strings`);
    }
  });

  return { valid: errors.length === 0, errors };
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
  if (!isFiniteNumber(json.remixProbability) || json.remixProbability < 0 || json.remixProbability > 1) {
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
  if (json.sentryDsn !== null && !isNonEmptyString(json.sentryDsn)) {
    errors.push('sentryDsn must be null or a non-empty string');
  }
  if (!isNonEmptyString(json.cronSchedule)) {
    errors.push('cronSchedule must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

const VALID_HISTORY_STATUSES = new Set(['published', 'failed_kept_previous']);

export function validateHistoryGames(json: unknown): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(json)) {
    return { valid: false, errors: ['root must be an array'] };
  }

  json.forEach((entry: unknown, i: number) => {
    if (!isPlainObject(entry)) {
      errors.push(`games[${i}] must be an object`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(typeof entry.date === 'string' ? entry.date : '')) {
      errors.push(`games[${i}].date must be a YYYY-MM-DD string`);
    }
    if (!isNonEmptyString(entry.status) || !VALID_HISTORY_STATUSES.has(entry.status)) {
      errors.push(`games[${i}].status must be one of: ${[...VALID_HISTORY_STATUSES].join(', ')}`);
    }
    if (!isNonEmptyString(entry.model)) {
      errors.push(`games[${i}].model must be a non-empty string`);
    }
    if (entry.status === 'published') {
      if (!isNonEmptyString(entry.slug)) errors.push(`games[${i}].slug must be a non-empty string when published`);
      if (!isNonEmptyString(entry.genre)) errors.push(`games[${i}].genre must be a non-empty string when published`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * A JWT whose payload claims the privileged `service_role`.
 *
 * Matched against the base64url payload segment rather than decoded: this
 * is a tripwire, not an authenticator, and it only has to catch the honest
 * mistake of pasting the wrong key from the dashboard.
 */
function looksLikeServiceRoleKey(value: string): boolean {
  const payload = value.split('.')[1];
  if (payload === undefined) return false;
  try {
    return Buffer.from(payload, 'base64url').toString('utf8').includes('service_role');
  } catch {
    return false;
  }
}

/**
 * Validates `config/reaction-config.json`.
 *
 * `anonKey` ships to every visitor in the page bundle, so the one thing
 * that must never appear here is the privileged read key — that belongs in
 * an Actions secret, and is used only by `fetch-feedback.ts`.
 */
export function validateReactionConfig(json: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(json)) {
    return { valid: false, errors: ['root must be an object'] };
  }

  const { endpointUrl, anonKey } = json;

  if (endpointUrl !== null && typeof endpointUrl !== 'string') {
    errors.push('endpointUrl must be a string or null');
  } else if (typeof endpointUrl === 'string' && !endpointUrl.startsWith('https://')) {
    errors.push('endpointUrl must be https — a reaction must never travel in the clear');
  }

  if (anonKey !== null && typeof anonKey !== 'string') {
    errors.push('anonKey must be a string or null');
  } else if (typeof anonKey === 'string' && looksLikeServiceRoleKey(anonKey)) {
    errors.push('anonKey looks like a service_role key — that key must never ship to the browser');
  }

  return { valid: errors.length === 0, errors };
}
