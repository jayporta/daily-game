// Real OpenRouter client. Request-shaping is unit-tested with a mocked
// fetchImpl (scripts/lib/openrouter-client.test.ts); this module never
// hits the network in tests since no OPENROUTER_API_KEY exists yet.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
}

export interface OpenRouterClient {
  complete(request: CompletionRequest): Promise<string>;
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
    async complete({ model, messages, temperature }: CompletionRequest): Promise<string> {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, temperature }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenRouter request failed: ${response.status} ${body}`);
      }

      const data: unknown = await response.json();
      const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message
        ?.content;
      if (typeof content !== 'string') {
        throw new Error('OpenRouter response missing choices[0].message.content');
      }
      return content;
    },
  };
}
