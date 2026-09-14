// The primitives validators are built from, and the one function that applies
// one to a file.
//
// Deliberately not a generic JSON-Schema engine — the rules themselves live
// beside the thing they describe (see config/ and history-store.ts), and only
// these primitives are shared.
import { isRecord } from '#lib/guards.ts';
import { readJson } from '#scripts/lib/json-file.ts';

/**
 * A verdict plus every problem behind it, for a check that narrows nothing.
 *
 * The file validators do not return this: each is a type predicate that
 * pushes onto a caller-owned array and narrows its input, which is what lets
 * {@link loadValidatedJson} return a typed value with no cast. This shape is
 * for a check with no value to narrow — `validate-config.ts`'s cross-file CSP
 * rule is the only one.
 */
export interface ValidationResult {
  /** Whether the value satisfies every rule. True exactly when `errors` is empty. */
  valid: boolean;
  /**
   * Every problem found, not just the first — this is what lets
   * `npm run validate` name all of them in one run.
   */
  errors: string[];
}

/** A string with at least one character. Rejects `''`, which most config fields treat as absent. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** A real number. Rejects `NaN` and both infinities, which survive `typeof x === 'number'`. */
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
 * `validate` is a type guard over `T`, not just a pass/fail check, so a
 * successful call narrows `parsed` for the compiler — no cast needed. Pair
 * one with a named loader beside the file's own rules, so each file has one
 * place where both are stated — see `config/models.ts` for the shape.
 *
 * @param validate Pushes every problem found onto `errors` — not just the
 *   first, which is what lets `npm run validate` name all of them in one
 *   run — then reports validity as its return value. `errors` is caller-owned
 *   and may already hold entries, so a validator reports only what that call
 *   added, measured against the array's length on entry.
 * @throws If the file cannot be read, is not JSON, or fails `validate`.
 */
export function loadValidatedJson<T>(
  filePath: string,
  validate: (json: unknown, errors: string[]) => json is T,
): T {
  const parsed = readJson(filePath);

  const errors: string[] = [];
  if (!validate(parsed, errors)) {
    throw new Error(`${filePath}: invalid — ${errors.join('; ')}`);
  }
  return parsed;
}
