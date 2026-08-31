// Browser-only request/response adapters for BYOK's four providers.
//
// Each provider shapes its request differently, so there is one builder per
// provider. Responses collapse further: OpenRouter and OpenAI share the same
// envelope, read by `firstChoiceContent` in lib/provider-response.ts — the
// same function the daily pipeline's OpenRouter client uses.
//
// This never touches OPENROUTER_API_KEY or scripts/lib/get-client.ts's
// mock-vs-real decision — a visitor's pasted key is a wholly separate,
// client-side-only path.
import { errorMessage } from '../../../lib/errors.ts';
import { arrayAt, recordAt, stringAt } from '../../../lib/guards.ts';
import {
  MAX_ERROR_DETAIL,
  firstChoiceContent,
  responseErrorDetail,
} from '../../../lib/provider-response.ts';
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
      }),
    },
  };
}

function buildGeminiRequest(request: ByokRequest): PreparedRequest {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
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

/** Reads `content[0].text`, as Anthropic's Messages API shapes it. */
function extractAnthropicText(data: unknown): string | null {
  return stringAt(arrayAt(data, 'content')?.[0], 'text');
}

/** Reads `candidates[0].content.parts[0].text`, as Gemini's generateContent shapes it. */
function extractGeminiText(data: unknown): string | null {
  const candidate: unknown = arrayAt(data, 'candidates')?.[0];
  const parts = arrayAt(recordAt(candidate, 'content'), 'parts');
  return stringAt(parts?.[0], 'text');
}

function extractText(provider: ByokProvider, data: unknown): string | null {
  switch (provider) {
    case 'openrouter':
    case 'openai':
      return firstChoiceContent(data);
    case 'anthropic':
      return extractAnthropicText(data);
    case 'gemini':
      return extractGeminiText(data);
  }
}

/**
 * Runs one BYOK completion request. Single attempt, no retry — it is the
 * visitor's own credits.
 */
export async function completeByok(
  request: ByokRequest,
  { fetchImpl = fetch }: ByokFetchOptions = {},
): Promise<ByokCompletionResult> {
  const { url, init } = buildRequest(request);

  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    return { ok: false, message: `Could not reach ${request.provider}: ${errorMessage(error)}` };
  }

  if (!response.ok) {
    const detail = await responseErrorDetail(response, MAX_ERROR_DETAIL);
    return { ok: false, message: `${request.provider} request failed (${response.status}): ${detail}` };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, message: `${request.provider} returned a response that was not JSON` };
  }

  const text = extractText(request.provider, data);
  if (text === null) {
    return { ok: false, message: `${request.provider} response did not carry the expected completion text` };
  }
  return { ok: true, text };
}
