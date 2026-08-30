// Hand-written config/history validators. Deliberately not a generic
// JSON-Schema engine — these are small, specific, and easy to read without
// adding a dependency. Each takes `unknown` (the direct result of
// JSON.parse) since the whole point is validating input we don't yet
// trust matches scripts/lib/types.ts's shapes.
import { isReactionConfig } from '../../lib/reaction-types.ts';
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

/** An object used as a lookup table, every value of which passes `isValid`. */
function isRecordOf(v: unknown, isValid: (entry: unknown) => boolean): boolean {
  return isPlainObject(v) && Object.values(v).every(isValid);
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
 * Validates `history/summary.json`.
 *
 * Every field is optional: `readSummary` fills a missing one from the empty
 * summary. A field that is present must carry the right type, since it is
 * spread over the defaults and reaches the prompt builder unchecked.
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

/**
 * Checks that `index.html`'s CSP permits the configured reaction store.
 *
 * A `srcdoc` iframe inherits the parent's CSP and `connect-src` starts as
 * `'self'`, so a cross-origin store is blocked unless its origin is listed.
 * `sendReaction` swallows that failure by design, which means a missing
 * origin drops every reaction with nothing anywhere reporting it — hence a
 * check rather than a comment.
 *
 * @param endpointUrl From `config/reaction-config.json`; `null` means no
 *   store is configured and there is nothing to permit.
 */
export function validateCspAllowsEndpoint(
  endpointUrl: string | null,
  indexHtml: string,
): ValidationResult {
  if (endpointUrl === null) return { valid: true, errors: [] };

  let origin: string;
  try {
    origin = new URL(endpointUrl).origin;
  } catch {
    return { valid: false, errors: [`endpointUrl is not a URL: ${endpointUrl}`] };
  }

  // Scoped to the policy's own `content` attribute: index.html also discusses
  // connect-src in a comment, and matching that would read the prose instead
  // of the directive.
  const policy = /content="([^"]*connect-src[^"]*)"/i.exec(indexHtml)?.[1];
  const connectSrc = policy === undefined ? undefined : /connect-src([^;]*)/i.exec(policy)?.[1];
  if (connectSrc === undefined) {
    return { valid: false, errors: ['index.html has no connect-src directive'] };
  }
  if (!connectSrc.split(/\s+/).includes(origin)) {
    return {
      valid: false,
      errors: [
        `index.html's connect-src does not list ${origin} — the browser would ` +
          'block every reaction, and sendReaction swallows that failure silently',
      ],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * The `role` a legacy Supabase JWT claims, or `null` if it is not one.
 *
 * Decoded rather than pattern-matched, so `service_role` cannot slip through
 * on an encoding quirk. This is a tripwire, not an authenticator — it only
 * has to catch the honest mistake of copying the wrong key.
 */
function jwtRole(value: string): string | null {
  const payload = value.split('.')[1];
  if (payload === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || !('role' in parsed)) return null;
    return typeof parsed.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

/**
 * Whether a key is one of the shapes Supabase publishes as safe for a browser.
 *
 * An allowlist, not a denylist: this value ships to every visitor, so an
 * unrecognised shape has to fail loudly rather than be assumed harmless.
 * Supabase's newer secret keys (`sb_secret_…`) are not JWTs, so a check that
 * only decoded JWTs would wave one straight through into the page.
 */
function isPublicKey(value: string): boolean {
  if (value.startsWith('sb_publishable_')) return true;
  return jwtRole(value) === 'anon';
}

/**
 * Validates `config/reaction-config.json`.
 *
 * `anonKey` ships to every visitor in the page bundle, so it must be one of
 * the shapes Supabase publishes for browser use. The privileged key belongs
 * in an Actions secret and is used only by `fetch-feedback.ts`.
 */
export function validateReactionConfig(json: unknown): ValidationResult {
  // Shape from the shared guard; the checks below are deployment policy.
  if (!isReactionConfig(json)) {
    return {
      valid: false,
      errors: ['must be an object with endpointUrl and anonKey, each a string or null'],
    };
  }

  const errors: string[] = [];
  const { endpointUrl, anonKey } = json;

  if (endpointUrl !== null && !endpointUrl.startsWith('https://')) {
    errors.push('endpointUrl must be https — a reaction must never travel in the clear');
  }
  if (anonKey !== null && !isPublicKey(anonKey)) {
    errors.push(
      'anonKey must be a publishable key (sb_publishable_...) or a legacy anon JWT. ' +
        'This value ships to every visitor, so a secret or service_role key must ' +
        'never appear here, and an unrecognised shape is refused rather than trusted',
    );
  }

  return { valid: errors.length === 0, errors };
}
