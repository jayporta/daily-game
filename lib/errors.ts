// Turns an unknown thrown value into something safe to show or record.
// `catch` binds `unknown`, and a `throw` can carry anything.
//
// In lib/ because both sides use it: the browser's fetch handler and every
// catch in the Node pipeline.

/**
 * The most useful message a thrown value can offer.
 *
 * @param error Whatever `catch` bound — an `Error`, or anything at all.
 * @returns An `Error`'s `message`, a thrown string as-is, and a best-effort
 *   rendering of anything else. Never throws, and never returns an empty
 *   string, so the result is always safe to interpolate.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  // Before the coercion below, which renders these as "undefined" and "null".
  if (error === undefined || error === null) return 'unknown error';
  try {
    const rendered = String(error);
    return rendered.length > 0 ? rendered : 'unknown error';
  } catch {
    // An object with a null prototype has no `toString`, so coercion throws.
    return 'unknown error';
  }
}
