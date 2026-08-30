// Shared fixtures for the browser-side tests, mirroring
// scripts/lib/fixtures.ts on the Node side.
//
// The name must not begin `test-`: node --test's default glob claims that
// prefix and would run this file as a suite.
import type { Manifest } from '../../lib/types.ts';

/**
 * A published day, as `publish.ts` writes it.
 *
 * Pinned against the frozen clock of `2026-08-29T12:00:00Z` the tests set:
 * generated three hours before it, expiring six hours after. Spread it to
 * override a field.
 */
export const MANIFEST: Manifest = {
  date: '2026-08-29',
  slug: '2026-08-29-beetle',
  path: 'games/archive/2026-08-29-beetle/game.html',
  title: 'Beetle of a Thousand Mirrors',
  genre: 'maze-adventure',
  genreLabel: 'Maze Adventure',
  model: 'qwen/qwen-2.5-72b-instruct:free',
  generatedAt: '2026-08-29T09:04:00.000Z',
  expiresAt: '2026-08-29T18:00:00.000Z',
  controls: [{ action: 'Move', key: 'Arrow keys' }],
};

/** A minimal bundle: enough to be framed, not enough to do anything. */
export const BUNDLE = '<!doctype html><html><body><canvas></canvas></body></html>';
