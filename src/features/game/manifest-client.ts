// Fetching the manifest and the day's published files, kept free of React so
// it can be unit tested with a stubbed fetch. The manifest's own shape guard
// lives with its type in lib/manifest.ts, since the pipeline checks it too.
import { isManifest } from '#lib/manifest.ts';
import type { Manifest } from '#lib/manifest.ts';

/**
 * Cache-busted so a visitor never sees yesterday's game from cache.
 *
 * The one URL on the site whose contents change: it is rewritten every day,
 * at the same path. Everything it points at is per-day and immutable.
 */
export function manifestUrl(now: number = Date.now()): string {
  return `manifest.json?t=${now}`;
}

/** Injection points that let these functions be tested without a network. */
export interface FetchOptions {
  /** Replaces global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Timestamp used for cache-busting. */
  readonly now?: number;
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
 * Loads a published, repo-relative text file — the game bundle's HTML or
 * its prompt file (see `Manifest.promptPath`).
 *
 * Cached normally, unlike {@link fetchManifest}: these paths carry the day's
 * slug, so a published file at a given URL never changes. That is what lets a
 * refresh reuse the bundle it already has, and a back navigation restore from
 * the bfcache.
 *
 * @param path Repo-relative path from the manifest, e.g.
 *   `games/archive/2026-08-29-slug/game.html`.
 * @throws If the file cannot be fetched.
 */
export async function fetchText(
  path: string,
  { fetchImpl = fetch }: FetchOptions = {},
): Promise<string> {
  const response = await fetchImpl(path);
  if (!response.ok) {
    throw new Error(`could not load game (${response.status})`);
  }
  return response.text();
}
