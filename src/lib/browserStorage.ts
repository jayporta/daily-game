// The browser storage seam, shared by the theme and the reaction path.
//
// Nothing here reads or writes: callers do that inside their own try/catch,
// since what a failure costs differs between them.

/**
 * The slice of `localStorage` this project uses, so tests need no DOM.
 *
 * Both methods may throw: Safari's private mode denies access to a storage
 * that is present and looks usable.
 */
export interface WebStorage {
  /** Returns the stored string, or `null` when the key is absent. */
  getItem(key: string): string | null;
  /** Stores `value`; may throw, which every caller here tolerates. */
  setItem(key: string, value: string): void;
}

/**
 * The real `localStorage`, or `null` when it cannot be reached at all.
 *
 * `localStorage` is absent in some embedding contexts, and in Safari's
 * private mode the property access itself throws, before any call.
 */
export function localStorageOrNull(): WebStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
