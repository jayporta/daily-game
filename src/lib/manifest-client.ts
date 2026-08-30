// Fetching and validating the manifest, kept free of React so it can be
// unit tested with a stubbed fetch.
import type { ControlHint, Manifest } from '../../lib/types.ts';

/** The string-valued fields of {@link Manifest}, so the guard can't drift. */
const REQUIRED_STRING_FIELDS = [
  'date',
  'slug',
  'path',
  'title',
  'genre',
  'genreLabel',
  'model',
  'generatedAt',
  'expiresAt',
] as const satisfies readonly (keyof Manifest)[];

function isControlHint(value: unknown): value is ControlHint {
  if (typeof value !== 'object' || value === null) return false;
  if (!('action' in value) || !('key' in value)) return false;
  return typeof value.action === 'string' && typeof value.key === 'string';
}

/**
 * Full shape check. The manifest is written by our own pipeline, but the
 * seed-state file is `null` until the first game publishes, and a partial
 * one would otherwise render blank metadata rather than failing visibly.
 *
 * @param value Parsed JSON of unknown shape.
 */
export function isManifest(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) return false;
  if (!REQUIRED_STRING_FIELDS.every((field) => typeof Reflect.get(value, field) === 'string')) {
    return false;
  }
  const controls: unknown = Reflect.get(value, 'controls');
  return Array.isArray(controls) && controls.every(isControlHint);
}

/** Cache-busted so a visitor never sees yesterday's game from cache. */
export function manifestUrl(now: number = Date.now()): string {
  return `manifest.json?t=${now}`;
}

/** Injection points that let these functions be tested without a network. */
export interface FetchOptions {
  /** Replaces global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Timestamp used for cache-busting. */
  now?: number;
}

/** Returns null when no game has been published yet (seed-state manifest). */
export async function fetchManifest({
  fetchImpl = fetch,
  now = Date.now(),
}: FetchOptions = {}): Promise<Manifest | null> {
  const response = await fetchImpl(manifestUrl(now), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`could not load manifest (${response.status})`);
  }
  const parsed: unknown = await response.json();
  return isManifest(parsed) ? parsed : null;
}

/**
 * Loads a published bundle's raw HTML.
 *
 * @param path Repo-relative path from the manifest, e.g.
 *   `games/archive/2026-08-29-slug/game.html`.
 * @throws If the bundle cannot be fetched.
 */
export async function fetchGameHtml(
  path: string,
  { fetchImpl = fetch }: FetchOptions = {},
): Promise<string> {
  const response = await fetchImpl(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`could not load game (${response.status})`);
  }
  return response.text();
}
