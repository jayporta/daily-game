// Shared fixtures for the browser-side tests, mirroring
// scripts/lib/testFixtures.ts on the Node side.
//
// The `test` prefix must stay camelCase, never `test-`: node --test's
// default glob claims the hyphenated prefix and would run this file as a
// suite of its own.
import type { Manifest } from '../../lib/manifest.ts';

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
  promptPath: 'games/archive/2026-08-29-beetle/prompt.txt',
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
