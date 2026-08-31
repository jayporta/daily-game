// Browser-only request/response adapters for BYOK's four providers. Each
// provider shapes its request and response differently, so there is one
// builder and one extractor per provider rather than a shared shape.
//
// This never touches OPENROUTER_API_KEY or scripts/lib/get-client.ts's
// mock-vs-real decision — a visitor's pasted key is a wholly separate,
// client-side-only path.
import { errorMessage } from '../../../lib/errors.ts';
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

/** Cap on an error body shown to the visitor, before it reaches the DOM. */
const MAX_ERROR_DETAIL = 200;

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
        // Anthropic's own required, documented mechanism for a browser to
        // call their API directly — see the BYOK plan for why this is not a
        // workaround.
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

/** Reads `choices[0].message.content`, as OpenRouter and OpenAI both shape it. */
function extractOpenAiCompatibleText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  if (!('choices' in data) || !Array.isArray(data.choices)) return null;

  const choice: unknown = data.choices[0];
  if (typeof choice !== 'object' || choice === null || !('message' in choice)) return null;

  const message: unknown = choice.message;
  if (typeof message !== 'object' || message === null || !('content' in message)) return null;

  const content: unknown = message.content;
  return typeof content === 'string' ? content : null;
}

/** Reads `content[0].text`, as Anthropic's Messages API shapes it. */
function extractAnthropicText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  if (!('content' in data) || !Array.isArray(data.content)) return null;

  const block: unknown = data.content[0];
  if (typeof block !== 'object' || block === null || !('text' in block)) return null;

  const text: unknown = block.text;
  return typeof text === 'string' ? text : null;
}

/** Reads `candidates[0].content.parts[0].text`, as Gemini's generateContent shapes it. */
function extractGeminiText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  if (!('candidates' in data) || !Array.isArray(data.candidates)) return null;

  const candidate: unknown = data.candidates[0];
  if (typeof candidate !== 'object' || candidate === null || !('content' in candidate)) return null;

  const content: unknown = candidate.content;
  if (typeof content !== 'object' || content === null || !('parts' in content)) return null;
  if (!Array.isArray(content.parts)) return null;

  const part: unknown = content.parts[0];
  if (typeof part !== 'object' || part === null || !('text' in part)) return null;

  const text: unknown = part.text;
  return typeof text === 'string' ? text : null;
}

function extractText(provider: ByokProvider, data: unknown): string | null {
  switch (provider) {
    case 'openrouter':
    case 'openai':
      return extractOpenAiCompatibleText(data);
    case 'anthropic':
      return extractAnthropicText(data);
    case 'gemini':
      return extractGeminiText(data);
  }
}

/**
 * The human-readable part of a failed response, truncated.
 *
 * Shown directly to the visitor, so this never returns the whole body —
 * some providers' error envelopes carry account identifiers that have no
 * business reaching the DOM.
 */
async function truncatedErrorDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const { error } = parsed;
      if (typeof error === 'object' && error !== null && 'message' in error) {
        const { message } = error;
        if (typeof message === 'string') return message.slice(0, MAX_ERROR_DETAIL);
      }
      if (typeof error === 'string') return error.slice(0, MAX_ERROR_DETAIL);
    }
  } catch {
    // Not JSON. Fall through to the truncated body.
  }
  return body.slice(0, MAX_ERROR_DETAIL);
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
    const detail = await truncatedErrorDetail(response);
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
