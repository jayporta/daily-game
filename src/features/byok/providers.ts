// Browser-only request/response adapters for BYOK's four providers.
//
// Each provider shapes its request differently, so there is one builder per
// provider, and each streams its output back in its own frame shape, so
// there is one delta reader per provider too. OpenRouter and OpenAI share
// both, through lib/provider-response.ts — the same module the daily
// pipeline's OpenRouter client reads its non-streaming responses with.
//
// Every call streams. The visitor watches the output arrive, so there is no
// second, non-streaming path to keep working.
//
// This never touches OPENROUTER_API_KEY or scripts/lib/get-client.ts's
// mock-vs-real decision — a visitor's pasted key is a wholly separate,
// client-side-only path.
import { errorMessage } from '#lib/errors.ts';
import { arrayAt, recordAt, stringAt } from '#lib/guards.ts';
import {
  MAX_ERROR_DETAIL,
  OPENROUTER_MAX_OUTPUT_TOKENS,
  classifyStopReason,
  errorDetail,
  firstChoiceDelta,
  firstChoiceFinishReason,
  responseErrorDetail,
} from '#lib/provider-response.ts';
import { readSseData } from '#src/features/byok/sseStream.ts';
import type { ByokProvider } from '#lib/byok-config-types.ts';
import type { ProviderStopReason } from '#lib/provider-response.ts';

/** One generation, in the form every provider's request is built from. */
export interface ByokRequest {
  /** Which provider's API shape and endpoint to use. */
  readonly provider: ByokProvider;
  /** The provider's own model id, sent verbatim. */
  readonly model: string;
  /**
   * The visitor's key.
   *
   * Written into a request header and nowhere else — never a URL, never
   * state, never a log or an error message. It lives for the duration of this
   * one call.
   */
  readonly apiKey: string;
  /** The fixed system prompt every generation shares. */
  readonly systemPrompt: string;
  /** The archived prompt, plus whatever this run adds to it. */
  readonly userPrompt: string;
}

/**
 * What went wrong, as a closed vocabulary rather than a message to match on.
 *
 * Drives two decisions the wording cannot: what to tell the visitor, and
 * whether the failure is worth reporting. See {@link isExpectedFailure}.
 */
export type ByokFailureKind =
  | 'auth'
  | 'rate-limit'
  | 'quota'
  | 'refused'
  | 'provider'
  | 'network'
  | 'stream'
  | 'empty';

export type ByokCompletionResult =
  | { ok: true; text: string; stop: ProviderStopReason }
  | { ok: false; message: string; kind: ByokFailureKind };

/**
 * Whether a failure is a normal part of using someone else's API key, rather
 * than a defect worth a Sentry event.
 *
 * A rejected key, an exhausted quota, a rate limit, a model declining the
 * request and an unreachable network are all the visitor's side of the call:
 * reporting them would bury the failures that are actually ours under events
 * nobody can act on.
 */
export function isExpectedFailure(kind: ByokFailureKind): boolean {
  switch (kind) {
    case 'auth':
    case 'rate-limit':
    case 'quota':
    case 'refused':
    case 'network':
      return true;
    case 'provider':
    case 'stream':
    case 'empty':
      return false;
  }
}

/**
 * The failure a non-ok HTTP status represents.
 *
 * The three statuses every provider here uses for the visitor's own account
 * are named; anything else is a provider fault and is reported.
 */
function failureKindForStatus(status: number): ByokFailureKind {
  switch (status) {
    case 401:
    case 403:
      return 'auth';
    case 402:
      return 'quota';
    case 429:
      return 'rate-limit';
    default:
      return 'provider';
  }
}

export interface ByokFetchOptions {
  /** Replaces global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * Called with each fragment as it arrives, for the live console.
   *
   * Fires many times per second on a fast model, so a caller that renders it
   * must batch — see `useGenerationStream`.
   */
  onDelta?: (fragment: string) => void;
  /**
   * Abandons the request. Aborting mid-stream ends the run as a failure,
   * which the caller distinguishes from a real one.
   */
  signal?: AbortSignal;
}

/**
 * The output cap per provider.
 *
 * Per-provider because this is not the size of a game. Every reasoning model
 * in the catalogue — the Gemini 3 line, the GPT-5.x line — spends this one
 * budget on its thinking *and* its answer, so a cap sized for a game leaves
 * nothing to answer with once the model has thought: the response is cut off
 * mid-document and arrives with no closing fence. A game is roughly 5,000
 * output tokens, so the three direct providers get room for both, within
 * every catalogue model's documented maximum output.
 *
 * OpenRouter keeps the smaller cap, shared with the daily pipeline's own
 * OpenRouter client as {@link OPENROUTER_MAX_OUTPUT_TOKENS}: it fronts small
 * free models that may refuse a request asking for more than they can
 * produce.
 */
const MAX_OUTPUT_TOKENS: Record<ByokProvider, number> = {
  openrouter: OPENROUTER_MAX_OUTPUT_TOKENS,
  openai: 64000,
  anthropic: 64000,
  gemini: 64000,
};

interface PreparedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * The output cap's field name, which differs between the two
 * OpenAI-shaped APIs.
 *
 * OpenAI's reasoning models — the whole GPT-5 and o-series line — reject
 * `max_tokens` outright with "Unsupported parameter", so a direct call must
 * send `max_completion_tokens`. OpenRouter normalises the older name across
 * every provider it fronts, so it keeps `max_tokens`.
 */
type TokenLimitField = 'max_tokens' | 'max_completion_tokens';

function buildOpenAiCompatibleRequest(
  baseUrl: string,
  request: ByokRequest,
  tokenLimitField: TokenLimitField,
): PreparedRequest {
  return {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        [tokenLimitField]: MAX_OUTPUT_TOKENS[request.provider],
        stream: true,
      }),
    },
  };
}

function buildAnthropicRequest(request: ByokRequest): PreparedRequest {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    init: {
      method: 'POST',
      headers: {
        'x-api-key': request.apiKey,
        'anthropic-version': '2023-06-01',
        // Anthropic's own documented opt-in for calling their API straight
        // from a browser. Required: without it the request is refused.
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: MAX_OUTPUT_TOKENS[request.provider],
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
        stream: true,
      }),
    },
  };
}

function buildGeminiRequest(request: ByokRequest): PreparedRequest {
  return {
    // `alt=sse` is what makes streamGenerateContent frame its output as SSE
    // rather than as one incrementally-delivered JSON array.
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
    init: {
      method: 'POST',
      headers: {
        'x-goog-api-key': request.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS[request.provider] },
      }),
    },
  };
}

function buildRequest(request: ByokRequest): PreparedRequest {
  switch (request.provider) {
    case 'openrouter':
      return buildOpenAiCompatibleRequest('https://openrouter.ai/api/v1', request, 'max_tokens');
    case 'openai':
      return buildOpenAiCompatibleRequest('https://api.openai.com/v1', request, 'max_completion_tokens');
    case 'anthropic':
      return buildAnthropicRequest(request);
    case 'gemini':
      return buildGeminiRequest(request);
  }
}

/**
 * Reads a text fragment from one of Anthropic's stream events.
 *
 * Only `content_block_delta` carries text; the run also emits
 * `message_start`, `content_block_start`, `ping` and the stop events, none
 * of which is an error.
 */
function extractAnthropicDelta(data: unknown): string | null {
  if (stringAt(data, 'type') !== 'content_block_delta') return null;
  return stringAt(recordAt(data, 'delta'), 'text');
}

/**
 * Reads `candidates[0].content.parts[0].text`.
 *
 * Gemini frames a streamed chunk exactly like a whole response, so this is
 * the same read either way.
 */
function extractGeminiDelta(data: unknown): string | null {
  const candidate: unknown = arrayAt(data, 'candidates')?.[0];
  const parts = arrayAt(recordAt(candidate, 'content'), 'parts');
  return stringAt(parts?.[0], 'text');
}

/** The text a single stream frame contributes, or `null` if it carries none. */
function extractDelta(provider: ByokProvider, data: unknown): string | null {
  switch (provider) {
    case 'openrouter':
    case 'openai':
      return firstChoiceDelta(data);
    case 'anthropic':
      return extractAnthropicDelta(data);
    case 'gemini':
      return extractGeminiDelta(data);
  }
}

/**
 * The stop reason a single frame reports, or `null` if it reports none.
 *
 * Every provider sends this on its own final frame, separately from the text:
 * OpenAI-shaped APIs on the last `choices[0]`, Anthropic on a `message_delta`
 * event, Gemini on every candidate once the run ends. Ignoring it is what
 * makes a response cut off at the output cap look like a model that ignored
 * the output format. The vocabulary the raw token is classified against —
 * every spelling of "I ran out of room" and "I declined" across the three
 * API shapes — lives in {@link classifyStopReason}, shared with the daily
 * pipeline's non-streaming OpenRouter client.
 */
function extractStopReason(provider: ByokProvider, data: unknown): ProviderStopReason | null {
  switch (provider) {
    case 'openrouter':
    case 'openai':
      return classifyStopReason(firstChoiceFinishReason(data));
    case 'anthropic':
      return classifyStopReason(stringAt(recordAt(data, 'delta'), 'stop_reason'));
    case 'gemini':
      return classifyStopReason(stringAt(arrayAt(data, 'candidates')?.[0], 'finishReason'));
  }
}

/** The OpenAI-shaped sentinel closing a stream. Carries no JSON. */
const STREAM_DONE = '[DONE]';

/**
 * A provider's error reported mid-stream rather than as an HTTP status.
 *
 * OpenRouter in particular answers 200 and then sends the failure — an
 * exhausted credit balance, an upstream refusal — as a frame. Without this
 * the run would look like a model that simply said nothing.
 */
function streamedError(data: unknown): string | null {
  const error: unknown = recordAt(data, 'error') ?? stringAt(data, 'error');
  if (error === null) return null;
  return typeof error === 'string'
    ? error.slice(0, MAX_ERROR_DETAIL)
    : (stringAt(error, 'message')?.slice(0, MAX_ERROR_DETAIL) ?? 'unspecified error');
}

/**
 * Runs one BYOK completion request, streaming. Single attempt, no retry — it
 * is the visitor's own credits.
 *
 * @param onDelta Called with each fragment as it arrives. The full text is
 *   returned as well, so a caller that only wants the result can ignore it.
 * @param signal Abandons the request. An abort surfaces as a failure here;
 *   telling that apart from a real one is the caller's job.
 * @returns The assembled completion and how it ended, or the reason it could
 *   not be had. A stream that ends having produced nothing is a failure: an
 *   empty game is not a game, and the visitor has paid for the call either
 *   way. Text that arrived is returned even when the run was cut short —
 *   `stop` is what says so, and a partial document is still worth showing.
 */
export async function completeByok(
  request: ByokRequest,
  { fetchImpl = fetch, onDelta, signal }: ByokFetchOptions = {},
): Promise<ByokCompletionResult> {
  const { url, init } = buildRequest(request);

  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, ...(signal ? { signal } : {}) });
  } catch (error) {
    return {
      ok: false,
      kind: 'network',
      message: `Could not reach ${request.provider}: ${errorMessage(error)}`,
    };
  }

  if (!response.ok) {
    const detail = await responseErrorDetail(response, MAX_ERROR_DETAIL);
    return {
      ok: false,
      kind: failureKindForStatus(response.status),
      message: `${request.provider} request failed (${response.status}): ${detail}`,
    };
  }

  let text = '';
  // The last stop reason any frame reported. Providers send it on a final
  // frame that carries no text, so it cannot be read from the fragments.
  let stop: ProviderStopReason = 'complete';
  try {
    for await (const payload of readSseData(response)) {
      if (payload === STREAM_DONE) break;

      let data: unknown;
      try {
        data = JSON.parse(payload);
      } catch {
        // A frame that is not JSON is not fatal on its own; a stream made
        // entirely of them ends as the empty-output failure below. This is
        // also where a provider answering with a plain error body instead of
        // a stream lands.
        continue;
      }

      const failure = streamedError(data);
      if (failure !== null) {
        return { ok: false, kind: 'refused', message: `${request.provider} reported: ${failure}` };
      }

      // Read before the text, and kept rather than overwritten: the frame
      // announcing the stop usually carries no fragment, and on Gemini every
      // frame after it repeats one.
      stop = extractStopReason(request.provider, data) ?? stop;

      const fragment = extractDelta(request.provider, data);
      if (fragment === null || fragment.length === 0) continue;
      text += fragment;
      onDelta?.(fragment);
    }
  } catch (error) {
    return {
      ok: false,
      kind: 'stream',
      message: `${request.provider} stream ended early: ${errorMessage(error)}`,
    };
  }

  if (text.length === 0) {
    const hint = errorDetail(await unreadBody(response));
    return {
      ok: false,
      kind: stop === 'refused' ? 'refused' : 'empty',
      message: hint.length > 0
        ? `${request.provider} returned no output: ${hint}`
        : `${request.provider} returned no output`,
    };
  }
  return { ok: true, text, stop };
}

/**
 * A best-effort look at a response that produced no fragments, so the visitor
 * sees why rather than a bare "no output".
 *
 * @returns The unread body, or `''` once the stream has consumed it — which
 *   is the usual case, and why the caller treats this as optional detail.
 */
async function unreadBody(response: Response): Promise<string> {
  return response.bodyUsed ? '' : await response.text().catch(() => '');
}
