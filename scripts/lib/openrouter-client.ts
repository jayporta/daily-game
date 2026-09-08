// Real OpenRouter client. Request-shaping is unit-tested with a mocked
// fetchImpl (scripts/lib/__tests__/openrouter-client.test.ts); this module
// never hits the network in tests.
//
// Reading the response — the fragments, the stop reason and the error body —
// lives in lib/provider-response.ts, shared with the browser's BYOK path,
// which calls the same OpenAI-shaped API and streams it the same way.

import { errorMessage } from '#lib/errors.ts';
import type { ProviderStopReason } from '#lib/provider-response.ts';
import {
  classifyStopReason,
  firstChoiceDelta,
  firstChoiceFinishReason,
  OPENROUTER_MAX_OUTPUT_TOKENS,
  responseErrorDetail,
  streamedError,
  streamedFrames,
} from '#lib/provider-response.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  /**
   * Overall cap for this one call, overriding the client's default.
   *
   * @remarks
   * For a call that is not a generation. The default is sized for a model
   * writing a whole game, which is minutes of output; a moderation verdict or
   * a lessons note needs a small fraction of that, and letting either inherit
   * the generation cap is what pushes a worst-case run past the workflow's
   * limit. The idle deadline is unaffected — silence means the same thing
   * whatever the call is for.
   */
  timeoutMs?: number;
}

export interface CompletionResult {
  readonly text: string;
  /** How the response ended — see {@link ProviderStopReason}. */
  readonly stop: ProviderStopReason;
}

export interface OpenRouterClient {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/**
 * How long a request may go with nothing arriving before it is abandoned.
 *
 * @remarks
 * The real hang detector, and the reason every call streams. A full game is
 * tens of thousands of tokens and the free models take minutes to write one,
 * so a deadline on the whole request cannot tell slow from stuck: any value
 * long enough for an honest generation is far too long to notice a dead
 * socket. Measured against a healthy stream, fragments arrive well under a
 * second apart, so silence for a minute means the connection is gone.
 */
export const OPENROUTER_IDLE_TIMEOUT_MS = 60_000;

/**
 * The most one generation may take however steadily it streams.
 *
 * @remarks
 * A backstop against a provider that trickles forever rather than stopping,
 * which idle time alone would never catch. Sized by working backwards from
 * the workflow's 90-minute cap, since a job killed by that cap never records
 * `failed_kept_previous`:
 *
 * ```
 * 4 setup + 7 attempts x (9 generation + 2 moderation + 0.6 smoke)
 *   + 2 reflection + 1 rollup = 88.2 min
 * ```
 *
 * Nine minutes is the largest value that fits, and it clears a measured
 * healthy generation (469s) by only about a minute. That margin is thin on
 * purpose: aborting an honest generation costs one attempt out of seven,
 * while overrunning the cap costs the run its whole failure path. Recompute
 * this whenever the rotation in `config/models.json` grows.
 */
export const OPENROUTER_TIMEOUT_MS = 540_000;

export interface CreateOpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Overall per-request cap; defaults to {@link OPENROUTER_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Silence tolerated mid-stream; defaults to {@link OPENROUTER_IDLE_TIMEOUT_MS}. */
  idleTimeoutMs?: number;
}

/**
 * A refusal from OpenRouter, carrying the status code that came with it.
 *
 * @remarks
 * The status is a field rather than only part of the message because the
 * pipeline has to tell an exhausted quota from a server fault, and reading
 * that back out of a string is not a contract worth depending on. Raised for
 * a non-2xx response and for a failure OpenRouter reports mid-stream, which
 * it does with the same codes.
 */
export class OpenRouterHttpError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`OpenRouter request failed: ${status} ${detail}`);
    this.name = 'OpenRouterHttpError';
    this.status = status;
  }
}

/**
 * Statuses meaning the account has nothing left to spend, rather than that
 * this particular request was wrong: 429 covers the free tier's daily cap as
 * well as short rate limits, and 402 is exhausted credits.
 */
const QUOTA_STATUSES: ReadonlySet<number> = new Set([402, 429]);

/** Whether a thrown value is OpenRouter refusing on capacity grounds. */
export function isQuotaFailure(error: unknown): boolean {
  return error instanceof OpenRouterHttpError && QUOTA_STATUSES.has(error.status);
}

/**
 * The two deadlines one request runs under, as a signal to abort it.
 *
 * @remarks
 * Both abort with an `Error` rather than the platform's own reason, so what
 * `history/games.json` records names which deadline was missed. `bump` restarts
 * the idle clock and is called for every byte off the wire, keep-alive comments
 * included — a provider sends those precisely to say it is still there.
 *
 * @param idleMs Silence tolerated between chunks.
 * @param overallMs Cap on the whole request, idle or not.
 * @returns `close` must run whatever the outcome, and is final: a later bump
 *   is ignored rather than re-arming a clock nothing will clear.
 */
function createDeadlines(
  idleMs: number,
  overallMs: number,
): { signal: AbortSignal; bump: () => void; close: () => void } {
  const controller = new AbortController();
  const overall = setTimeout(() => {
    controller.abort(new Error(`gave up after ${Math.round(overallMs / 1000)}s`));
  }, overallMs);

  let idle: ReturnType<typeof setTimeout>;
  let closed = false;
  const bump = (): void => {
    if (closed) return;
    clearTimeout(idle);
    idle = setTimeout(() => {
      controller.abort(new Error(`nothing received for ${Math.round(idleMs / 1000)}s`));
    }, idleMs);
  };
  bump();

  return {
    signal: controller.signal,
    bump,
    close: () => {
      // Final: a bump arriving after this would re-arm the clock it just
      // cleared, leaving a timer alive past the request that owned it.
      closed = true;
      clearTimeout(overall);
      clearTimeout(idle);
    },
  };
}

/**
 * The same response, with `onBytes` called for every chunk of its body.
 *
 * @remarks
 * Taps the body rather than the decoded frames so that keep-alives and
 * partial frames count as activity too. A response with no readable body is
 * returned untouched: there is nothing to watch, and `readSseData` reads it
 * whole.
 */
function watchBytes(response: Response, onBytes: () => void): Response {
  const body = response.body;
  if (body === null) return response;

  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      onBytes();
      controller.enqueue(chunk);
    },
  });
  return new Response(body.pipeThrough(tap));
}

export function createOpenRouterClient({
  apiKey,
  baseUrl = 'https://openrouter.ai/api/v1',
  fetchImpl = fetch,
  timeoutMs = OPENROUTER_TIMEOUT_MS,
  idleTimeoutMs = OPENROUTER_IDLE_TIMEOUT_MS,
}: CreateOpenRouterClientOptions): OpenRouterClient {
  if (!apiKey) throw new Error('createOpenRouterClient requires an apiKey');

  return {
    async complete({
      model,
      messages,
      temperature,
      timeoutMs: requestTimeoutMs,
    }: CompletionRequest): Promise<CompletionResult> {
      const deadlines = createDeadlines(idleTimeoutMs, requestTimeoutMs ?? timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: deadlines.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: OPENROUTER_MAX_OUTPUT_TOKENS,
            stream: true,
          }),
        });

        if (!response.ok) {
          throw new OpenRouterHttpError(response.status, await responseErrorDetail(response));
        }

        // Awaited, not returned: `finally` runs the moment an async function
        // returns, so handing back the promise unawaited would clear both
        // timers before a single frame had been read.
        return await readStream(response, deadlines.bump);
      } finally {
        deadlines.close();
      }
    },
  };
}

/**
 * Assembles one completion from its stream.
 *
 * @param onBytes Called for every chunk of the body, to reset the idle clock.
 * @throws {OpenRouterHttpError} For a failure reported inside the stream that
 *   named a status, so an exhausted quota is classified the same whether
 *   OpenRouter refuses with a status or accepts and then gives up.
 * @throws {Error} For a stream that ends having produced no text at all, and
 *   for one cut short by either deadline.
 */
async function readStream(response: Response, onBytes: () => void): Promise<CompletionResult> {
  let text = '';
  // The last stop reason any frame reported. Providers send it on a final
  // frame carrying no text, so it cannot be read off the fragments.
  let stop: ProviderStopReason = 'complete';

  try {
    for await (const data of streamedFrames(watchBytes(response, onBytes))) {
      const failure = streamedError(data);
      if (failure !== null) {
        throw failure.status === null
          ? new Error(`OpenRouter reported: ${failure.message}`)
          : new OpenRouterHttpError(failure.status, failure.message);
      }

      stop = classifyStopReason(firstChoiceFinishReason(data)) ?? stop;
      text += firstChoiceDelta(data) ?? '';
    }
  } catch (error) {
    if (error instanceof OpenRouterHttpError) throw error;
    throw new Error(`OpenRouter stream ended early: ${errorMessage(error)}`, { cause: error });
  }

  if (text.length === 0) {
    throw new Error('OpenRouter stream carried no content');
  }
  return { text, stop };
}
