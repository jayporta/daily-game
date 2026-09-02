// Real OpenRouter client. Request-shaping is unit-tested with a mocked
// fetchImpl (scripts/lib/__tests__/openrouter-client.test.ts); this module
// never hits the network in tests.
//
// Reading the response — the completion text and the error body — lives in
// lib/provider-response.ts, shared with the browser's BYOK path, which calls
// the same OpenAI-shaped API.
import {
  OPENROUTER_MAX_OUTPUT_TOKENS,
  classifyStopReason,
  firstChoiceContent,
  firstChoiceFinishReason,
  responseErrorDetail,
} from '#lib/provider-response.ts';
import type { ProviderStopReason } from '#lib/provider-response.ts';

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

export interface CreateOpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createOpenRouterClient({
  apiKey,
  baseUrl = 'https://openrouter.ai/api/v1',
  fetchImpl = fetch,
}: CreateOpenRouterClientOptions): OpenRouterClient {
  if (!apiKey) throw new Error('createOpenRouterClient requires an apiKey');

  return {
    async complete({ model, messages, temperature }: CompletionRequest): Promise<CompletionResult> {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
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
        throw new Error(
          `OpenRouter request failed: ${response.status} ${await responseErrorDetail(response)}`,
        );
      }

      const data: unknown = await response.json();
      const content = firstChoiceContent(data);
      if (content === null) {
        throw new Error('OpenRouter response missing choices[0].message.content');
      }
      return { text: content, stop: classifyStopReason(firstChoiceFinishReason(data)) ?? 'complete' };
    },
  };
}
