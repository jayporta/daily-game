// Shared fixture loading for tests and for the mock client, so no test
// hardcodes the fixtures directory path or re-implements extraction.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratedMeta } from '#lib/extract-bundle-shared.ts';
import { extractBundle } from '#lib/extract-bundle-shared.ts';
import type { GenerationConfig } from '#scripts/lib/config/generation.ts';
import type { GenresConfig } from '#scripts/lib/config/genres.ts';
import type { FailedEntry, HistoryGameEntry, PublishedEntry } from '#scripts/lib/history-store.ts';
import type { OpenRouterClient } from '#scripts/lib/openrouter-client.ts';
import { isModerationRequest } from '#scripts/moderate.ts';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/mock-responses/', import.meta.url));

/**
 * A `fetch` that accepts the request and then never answers.
 *
 * Stands in for the socket that stalls rather than refusing — the one failure
 * a `catch` cannot see, because it never rejects. Only an `AbortSignal` on the
 * request ends this promise, so a caller that passes no signal hangs, which is
 * what makes it usable as a timeout test.
 */
export const neverAnswers: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')));
  });

/**
 * An SSE response carrying `frames` as `data:` payloads, then `[DONE]`.
 *
 * @param frames Each is serialised as one frame; a string is sent verbatim,
 *   so a test can send a payload that is not JSON.
 */
export function sseResponse(frames: readonly unknown[]): Response {
  const body = frames
    .map((frame) => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`)
    .join('');
  return new Response(`${body}data: [DONE]\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** One OpenAI-shaped streaming frame carrying a fragment of the answer. */
export function sseDelta(content: string, finishReason?: string): unknown {
  return {
    choices: [{ delta: { content }, ...(finishReason ? { finish_reason: finishReason } : {}) }],
  };
}

/**
 * A `fetch` answering 200 with a stream that opens and then goes quiet.
 *
 * @remarks
 * The failure a total deadline cannot tell from an honest slow generation:
 * the connection is up and some output has arrived, but nothing more is
 * coming. Only an idle deadline ends this.
 */
export const stallsMidStream: typeof fetch = (_input, init) =>
  Promise.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'),
          );
          // Errors with the signal's own reason, the way a real body does, so
          // a caller can still tell which deadline ended it.
          init?.signal?.addEventListener('abort', () => {
            controller.error(init.signal?.reason);
          });
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ),
  );

/**
 * A `fetch` answering 200 with `fragments` spaced `gapMs` apart.
 *
 * @remarks
 * Honours the request's signal, so a deadline firing mid-stream really does
 * end it. Without that the stream would run to completion whatever the caller
 * decided, and a test asserting that a deadline was *not* reached could not
 * fail.
 */
export function streamsSlowly(fragments: readonly string[], gapMs: number): typeof fetch {
  return (_input, init) =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder();
            init?.signal?.addEventListener('abort', () => {
              controller.error(init.signal?.reason);
            });
            for (const fragment of fragments) {
              await new Promise((resolve) => setTimeout(resolve, gapMs));
              if (init?.signal?.aborted === true) return;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(sseDelta(fragment))}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
}

export type FixtureName =
  | 'good-maze'
  | 'good-platformer'
  | 'bad-js-error'
  | 'bad-fetch-attempt'
  | 'bad-guardrail-word'
  | 'bad-malformed-blocks';

/** Raw model-style response text, exactly as the mock client would return it. */
export function loadFixture(name: FixtureName): string {
  return readFileSync(join(FIXTURES_DIR, `${name}.txt`), 'utf8');
}

/** Fixture parsed into its meta + html halves; throws if the fixture is unparseable. */
export function loadFixtureBundle(name: FixtureName): { meta: GeneratedMeta; html: string } {
  const result = extractBundle(loadFixture(name));
  if (!result.ok) {
    throw new Error(`fixture ${name} did not parse: ${result.reason}`);
  }
  return { meta: result.meta, html: result.html };
}

/**
 * A client that replays scripted generation responses, for driving the retry
 * loop without a network.
 *
 * The generator and the moderator share one client, so this has to answer
 * both. Generation fixtures are consumed in order; every other call is a
 * moderation call and gets `moderationVerdict`.
 *
 * @param generations Raw model-style responses, returned one per generation
 *   call. An exhausted list throws, which the pipeline records as a
 *   `generation-call` failure — the cheapest way to force a run to fail.
 */
export function scriptedClient(
  generations: string[],
  moderationVerdict = 'PASS',
): OpenRouterClient {
  const remaining = [...generations];
  return {
    async complete({ messages }) {
      if (isModerationRequest(messages)) return { text: moderationVerdict, stop: 'complete' };
      const next = remaining.shift();
      if (next === undefined) throw new Error('no generation fixture left');
      return { text: next, stop: 'complete' };
    },
  };
}

/**
 * A genre catalogue shaped like the real one — ids, readable labels and
 * non-empty examples, so it also satisfies `validateGenresConfig`.
 */
export const GENRES: GenresConfig = [
  { id: 'maze-adventure', label: 'Maze Adventure', examples: ['navigate a maze'] },
  { id: 'platformer', label: 'Platformer', examples: ['jump between platforms'] },
  { id: 'puzzle', label: 'Puzzle', examples: ['rearrange tiles'] },
];

/** The generation knobs, matching `config/generation.json`'s shape. */
export const GENERATION_CONFIG: GenerationConfig = {
  historyHotWindowDays: 45,
  rollupTriggerEntries: 60,
  remixProbability: 0.2,
  remixLookbackDays: 90,
  temperature: 0.7,
  sentryDsn: null,
  cronSchedule: '0 13 * * *',
};

/** The published day's slug, named so a test can assert against it directly. */
export const PUBLISHED_SLUG = '2026-08-28-beetle';

/** A day that published, as `publish.ts` records it. */
export const PUBLISHED_ENTRY: PublishedEntry = {
  date: '2026-08-28',
  status: 'published',
  model: 'a/model:free',
  slug: PUBLISHED_SLUG,
  genre: 'maze-adventure',
  theme: 'glass beetles',
  mechanics: ['move'],
  title: 'Beetle Maze',
};

/** A day that gave up and kept the previous game, as `recordFailure` records it. */
export const FAILED_ENTRY: FailedEntry = {
  date: '2026-08-29',
  status: 'failed_kept_previous',
  model: 'b/model:free',
  attempts: 3,
  failureReasons: ['attempt 1 (b/model:free): smoke test failed — uncaught JS error'],
  failureKinds: ['smoke-js-error'],
};

/**
 * The entry at `index`, insisting it is a published one.
 *
 * Assertions about likes, dislikes or a slug only typecheck against
 * {@link PublishedEntry}, and a test that finds a failed entry there has
 * already lost the thing it meant to assert on.
 *
 * @throws If there is no entry at `index`, or it is not published.
 */
export function publishedAt(entries: readonly HistoryGameEntry[], index: number): PublishedEntry {
  const entry = entries[index];
  if (entry === undefined || entry.status !== 'published') {
    throw new Error(`expected a published entry at ${index}, got ${JSON.stringify(entry)}`);
  }
  return entry;
}

/**
 * The entry at `index`, insisting the run failed.
 *
 * The mirror of {@link publishedAt}, for assertions about failure reasons
 * and kinds, which only {@link FailedEntry} carries.
 *
 * @throws If there is no entry at `index`, or it published a game.
 */
export function failedAt(entries: readonly HistoryGameEntry[], index: number): FailedEntry {
  const entry = entries[index];
  if (entry === undefined || entry.status !== 'failed_kept_previous') {
    throw new Error(`expected a failed entry at ${index}, got ${JSON.stringify(entry)}`);
  }
  return entry;
}
