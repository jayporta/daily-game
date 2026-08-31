// The shape questions every untrusted boundary in this project asks, and the
// answers, in one place.
//
// In lib/ because both build targets ask them: the browser of a provider's
// JSON response, of `manifest.json` and of `localStorage`; the pipeline of a
// config file and of an archive line. `scripts/lib/validation.ts` re-exports
// `isRecord` as `isPlainObject` so the Node validators keep their own
// vocabulary without holding a second definition.

/**
 * Narrows an untrusted value to one whose named properties can be read.
 *
 * Arrays are excluded deliberately. Every caller goes on to read a named
 * field, and an array satisfies `typeof x === 'object'` while having none —
 * so admitting one only defers the same failure to the field read.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The value of `field`, if `value` is a record holding a string there.
 *
 * @returns The string, or `null` when `value` is not a record, the field is
 *   absent, or it holds anything else. An empty string is a valid result.
 */
export function stringAt(value: unknown, field: string): string | null {
  if (!isRecord(value)) return null;
  const found: unknown = value[field];
  return typeof found === 'string' ? found : null;
}

/** The value of `field`, if `value` is a record holding a record there. */
export function recordAt(value: unknown, field: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const found: unknown = value[field];
  return isRecord(found) ? found : null;
}

/**
 * The value of `field`, if `value` is a record holding an array there.
 *
 * Returns the array as `unknown[]`, so indexing it still yields `unknown` and
 * the caller has to narrow each element in turn.
 */
export function arrayAt(value: unknown, field: string): unknown[] | null {
  if (!isRecord(value)) return null;
  const found: unknown = value[field];
  return Array.isArray(found) ? found : null;
}
