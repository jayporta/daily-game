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

/** What a BYOK regeneration returns, distinguishable from {@link BUNDLE}. */
export const BYOK_HTML = '<!doctype html><html><body>better game</body></html>';

/**
 * A model response in the two-fenced-block format `extractBundle` parses,
 * carrying {@link BYOK_HTML}. Shared so the panel, the hook and the whole-app
 * tests all exercise the same shape.
 */
export const BYOK_COMPLETION = [
  '```json',
  '{"title": "Regenerated Title", "genre": "maze-adventure", "theme": "th", "mechanics": ["m"], "controls": []}',
  '```',
  '',
  '```html',
  BYOK_HTML,
  '```',
].join('\n');

/** An OpenAI-shaped completion envelope wrapping `content`. */
export function completionResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

/** A JSON response, as a provider or the site's own manifest endpoint sends one. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * A `fetch` that answers everything with `response`.
 *
 * Annotated rather than cast: an arrow taking no parameters is assignable to
 * `typeof fetch`, so the `as unknown as typeof fetch` these tests used to
 * carry was never needed.
 *
 * A plain function, not a `vi.fn`: this module is imported by `*.test.ts`
 * files running under `node --test`, which has no Vitest runtime. A suite
 * that needs to count calls wraps its own spy.
 */
export function stubFetch(response: Response): typeof fetch {
  return async () => response;
}

