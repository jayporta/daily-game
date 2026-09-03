// Shared fixtures for the browser-side tests, mirroring
// scripts/lib/testFixtures.ts on the Node side.
//
// The `test` prefix must stay camelCase, never `test-`: node --test's
// default glob claims the hyphenated prefix and would run this file as a
// suite of its own.
import type { Manifest } from '#lib/manifest.ts';

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

/**
 * A response cut off at the provider's output cap.
 *
 * The `json` block completed, the `html` block did not, and the stream ends
 * with the provider saying why. The exact shape that made extraction report a
 * missing html block and the panel advise a different model — which never
 * helped, because the cap belonged to the request, not to the model.
 */
export function truncatedCompletionResponse(): Response {
  const partial = [
    '```json',
    '{"title": "Half a Game", "genre": "g", "theme": "t", "mechanics": []}',
    '```',
    '',
    '```html',
    '<!doctype html><html><body>half a g',
  ].join('\n');
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: partial } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`,
  ].join('');
  return new Response(`${frames}data: [DONE]\n\n`, { status: 200 });
}

/**
 * `content` as an OpenAI-shaped event stream, the way every BYOK call now
 * reads its answer.
 *
 * Split into three frames rather than one, so a test that watches fragments
 * arrive sees more than a single delivery. The shape is OpenRouter's, which
 * is the provider the panel selects first.
 */
export function completionResponse(content: string): Response {
  const third = Math.ceil(content.length / 3) || 1;
  const frames = [
    content.slice(0, third),
    content.slice(third, third * 2),
    content.slice(third * 2),
  ]
    .filter((fragment) => fragment.length > 0)
    .map(
      (fragment) => `data: ${JSON.stringify({ choices: [{ delta: { content: fragment } }] })}\n\n`,
    )
    .join('');
  return new Response(`${frames}data: [DONE]\n\n`, { status: 200 });
}

/**
 * A provider whose stream the test drives, fragment by fragment.
 *
 * Lets a test observe a generation while it is still running — the state the
 * live console exists for — rather than only its finished result.
 *
 * @returns `response`, the provider response to hand a stubbed fetch — one
 *   instance, since a body can only be read once; `push`, which delivers one
 *   fragment and waits for it to be consumed; and `close`, which ends it.
 */
export function openProviderStream(): {
  response: Response;
  push: (fragment: string) => Promise<void>;
  close: () => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(source) {
      controller = source;
    },
  });

  return {
    response: new Response(body, { status: 200 }),
    push: async (fragment: string) => {
      const frame = JSON.stringify({ choices: [{ delta: { content: fragment } }] });
      controller?.enqueue(encoder.encode(`data: ${frame}\n\n`));
      // A macrotask, so the reader has drained the chunk before the caller
      // asserts on what the console shows.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    close: () => controller?.close(),
  };
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
