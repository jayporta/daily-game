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
import { errorMessage } from '../../../lib/errors.ts';
import { arrayAt, recordAt, stringAt } from '../../../lib/guards.ts';
import {
  MAX_ERROR_DETAIL,
  errorDetail,
  firstChoiceDelta,
  responseErrorDetail,
} from '../../../lib/provider-response.ts';
import { readSseData } from './sseStream.ts';
import type { ByokProvider } from '../../../lib/byok-config-types.ts';

export interface ByokRequest {
  readonly provider: ByokProvider;
  readonly model: string;
  readonly apiKey: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export type ByokCompletionResult = { ok: true; text: string } | { ok: false; message: string };

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

/** Generous enough for a full self-contained game HTML file, for every provider. */
const MAX_OUTPUT_TOKENS = 16000;

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
        [tokenLimitField]: MAX_OUTPUT_TOKENS,
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
        max_tokens: MAX_OUTPUT_TOKENS,
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
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
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
 * @returns The assembled completion, or the reason it could not be had. A
 *   stream that ends having produced nothing is a failure: an empty game is
 *   not a game, and the visitor has paid for the call either way.
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
    return { ok: false, message: `Could not reach ${request.provider}: ${errorMessage(error)}` };
  }

  if (!response.ok) {
    const detail = await responseErrorDetail(response, MAX_ERROR_DETAIL);
    return { ok: false, message: `${request.provider} request failed (${response.status}): ${detail}` };
  }

  let text = '';
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
        return { ok: false, message: `${request.provider} reported: ${failure}` };
      }

      const fragment = extractDelta(request.provider, data);
      if (fragment === null || fragment.length === 0) continue;
      text += fragment;
      onDelta?.(fragment);
    }
  } catch (error) {
    return {
      ok: false,
      message: `${request.provider} stream ended early: ${errorMessage(error)}`,
    };
  }

  if (text.length === 0) {
    const hint = errorDetail(await unreadBody(response));
    return {
      ok: false,
      message: hint.length > 0
        ? `${request.provider} returned no output: ${hint}`
        : `${request.provider} returned no output`,
    };
  }
  return { ok: true, text };
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
