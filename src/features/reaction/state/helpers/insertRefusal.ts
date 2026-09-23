// Pulls the error code and violated constraint's name out of a refused insert's body.

import { isRecord, stringAt } from '#lib/guards.ts';

/** Tags safe to attach to a refused-insert report. */
export interface InsertRefusalTags {
  /** A Postgres SQLSTATE or a PostgREST error code. */
  readonly code?: string;
  /** The name of the constraint the insert violated, if any. */
  readonly constraint?: string;
}

/**
 * A five-character SQLSTATE (Postgres) or PostgREST's own three-digit code
 * prefixed `PGRST`. Anything else is free text the store could have put
 * there and is dropped rather than tagged.
 */
const CODE_PATTERN = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;

/** How Postgres names the violated constraint inside an error message. */
const CONSTRAINT_PATTERN = /constraint "([a-z0-9_]{1,63})"/;

/**
 * Extracts a whitelisted `code` and constraint name from a store's parsed
 * error body.
 *
 * `value` is untrusted: a field is kept only when it matches one of the
 * patterns above, so no string from the body reaches Sentry as anything but
 * one of these two known shapes.
 *
 * @returns `{}` for anything that isn't a record, or that matches neither
 *   pattern.
 */
export function insertRefusalTags(value: unknown): InsertRefusalTags {
  if (!isRecord(value)) return {};

  const tags: { code?: string; constraint?: string } = {};

  const code = stringAt(value, 'code');
  if (code !== null && CODE_PATTERN.test(code)) tags.code = code;

  const message = stringAt(value, 'message');
  const constraint = message === null ? undefined : CONSTRAINT_PATTERN.exec(message)?.[1];
  if (constraint !== undefined) tags.constraint = constraint;

  return tags;
}
