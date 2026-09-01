// Everything Node-side about `config/reaction-config.json`: its deployment
// rules and how it is read.
//
// Its type and shape guard live in `lib/reaction-types.ts` instead, not here:
// the browser POSTs the rows and so needs them too, and `lib/` is the only
// directory both tsconfigs compile.
import { isRecord } from '#lib/guards.ts';
import { isReactionConfig, type ReactionConfig } from '#lib/reaction-types.ts';
import { paths } from '#scripts/lib/paths.ts';
import { loadValidatedJson, type ValidationResult } from '#scripts/lib/validation.ts';

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
    if (!isRecord(parsed) || !('role' in parsed)) return null;
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

/**
 * Where the browser posts reactions. The pipeline reads only `endpointUrl`
 * from here — the key it reads the store back with is privileged and comes
 * from the environment, never from a committed file.
 *
 * @throws If the file is missing, unparseable, or fails validation.
 */
export function loadReactionConfig(filePath: string = paths.reactionConfig): ReactionConfig {
  return loadValidatedJson<ReactionConfig>(filePath, validateReactionConfig);
}

/**
 * Like {@link loadReactionConfig}, but never throws.
 *
 * The reaction store is decoration: a hand-edit that breaks this file must
 * cost the day its like counts, not its game. Every other config is
 * load-bearing and is still allowed to fail the run loudly.
 */
export function loadReactionConfigOrUnconfigured(
  filePath: string = paths.reactionConfig,
): ReactionConfig {
  try {
    return loadReactionConfig(filePath);
  } catch {
    return { endpointUrl: null, anonKey: null };
  }
}
