// Real OpenRouter client. Request-shaping is unit-tested with a mocked
// fetchImpl (scripts/lib/__tests__/openrouter-client.test.ts); this module
// never hits the network in tests.
//
// Reading the response — the completion text and the error body — lives in
// lib/provider-response.ts, shared with the browser's BYOK path, which calls
// the same OpenAI-shaped API.

import type { ProviderStopReason } from '#lib/provider-response.ts';
import {
  classifyStopReason,
  firstChoiceContent,
  firstChoiceFinishReason,
  OPENROUTER_MAX_OUTPUT_TOKENS,
  responseErrorDetail,
} from '#lib/provider-response.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
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
 * How long one completion may take before it is abandoned.
 *
 * A hung socket never rejects, so the `try`/`catch` around `complete()` in
 * generate-daily-game.ts cannot bound it on its own — without this the run
 * only ends at the workflow's 90-minute cap, skipping the
 * `failed_kept_previous` path entirely. Sized against that cap: one generation
 * plus one moderation call per active model at this timeout leave room for the
 * smoke tests and rollup.
 */
export const OPENROUTER_TIMEOUT_MS = 120_000;

export interface CreateOpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Per-request timeout; defaults to {@link OPENROUTER_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * A non-2xx answer from OpenRouter, carrying the status code.
 *
 * The status is a field rather than only part of the message because the
 * pipeline has to tell an exhausted quota from a server fault, and reading
 * that back out of a string is not a contract worth depending on.
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

export function createOpenRouterClient({
  apiKey,
  baseUrl = 'https://openrouter.ai/api/v1',
  fetchImpl = fetch,
  timeoutMs = OPENROUTER_TIMEOUT_MS,
}: CreateOpenRouterClientOptions): OpenRouterClient {
  if (!apiKey) throw new Error('createOpenRouterClient requires an apiKey');

  return {
    async complete({ model, messages, temperature }: CompletionRequest): Promise<CompletionResult> {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: OPENROUTER_MAX_OUTPUT_TOKENS,
        }),
      });

      if (!response.ok) {
        throw new OpenRouterHttpError(response.status, await responseErrorDetail(response));
      }

      const data: unknown = await response.json();
      const content = firstChoiceContent(data);
      if (content === null) {
        throw new Error('OpenRouter response missing choices[0].message.content');
      }
      return {
        text: content,
        stop: classifyStopReason(firstChoiceFinishReason(data)) ?? 'complete',
      };
    },
  };
}
