// The shared vocabulary every validator is written in, and the one function
// that applies one to a file.
//
// Deliberately not a generic JSON-Schema engine — the rules themselves live
// beside the thing they describe (see config/ and history-store.ts), and only
// these primitives are shared.
import { isRecord } from '#lib/guards.ts';
import { readJson } from '#scripts/lib/json-file.ts';

/** What every validator returns: a verdict plus every problem found, not just the first. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * The validators' name for {@link isRecord}, which lives in `lib/` because
 * the browser asks the same question of provider responses and stored JSON.
 * Re-exported rather than redefined so the two can never drift.
 */
export const isPlainObject = isRecord;

/** An array whose every element is a string. Narrows, so the result indexes as `string`. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** An object used as a lookup table, every value of which passes `isValid`. */
export function isRecordOf(v: unknown, isValid: (entry: unknown) => boolean): boolean {
  return isPlainObject(v) && Object.values(v).every(isValid);
}

/**
 * Reads, parses and validates a JSON file, returning it typed.
 *
 * Nothing in the types ties `T` to `validate`. Pair them in a named loader
 * beside the file's own rules, so each file has one place where both are
 * stated — see `config/models.ts` for the shape.
 *
 * @throws If the file cannot be read, is not JSON, or fails `validate`.
 */
export function loadValidatedJson<T>(
  filePath: string,
  validate: (json: unknown) => ValidationResult,
): T {
  const parsed = readJson(filePath);

  const result = validate(parsed);
  if (!result.valid) {
    throw new Error(`${filePath}: invalid — ${result.errors.join('; ')}`);
  }
  return parsed as T;
}
