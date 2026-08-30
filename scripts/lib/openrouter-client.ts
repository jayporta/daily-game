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

/** Cap on an error body we could not parse, before it reaches history. */
const MAX_ERROR_DETAIL = 200;

/**
 * The human-readable part of a failed response.
 *
 * Only the message, not the whole body: this string is stored in
 * `history/games.json`, which is public, and is shown to the model that
 * rewrites the lessons note. OpenRouter's error envelope also carries the
 * account's `user_id`, which has no business in either place.
 */
async function failureDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const { error } = parsed;
      if (typeof error === 'object' && error !== null && 'message' in error) {
        const { message } = error;
        if (typeof message === 'string') return message;
      }
    }
  } catch {
    // Not JSON. Fall through to the truncated body.
  }
  return body.slice(0, MAX_ERROR_DETAIL);
}

/**
 * The one field this client reads out of a completion response.
 *
 * @returns The assistant's text, or `null` if the response is not shaped
 *   the way the API documents, which the caller turns into a retry.
 */
function firstChoiceContent(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  if (!('choices' in data) || !Array.isArray(data.choices)) return null;

  const choice: unknown = data.choices[0];
  if (typeof choice !== 'object' || choice === null) return null;
  if (!('message' in choice)) return null;

  const message: unknown = choice.message;
  if (typeof message !== 'object' || message === null) return null;
  if (!('content' in message)) return null;

  const content: unknown = message.content;
  return typeof content === 'string' ? content : null;
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
        throw new Error(
          `OpenRouter request failed: ${response.status} ${await failureDetail(response)}`,
        );
      }

      const content = firstChoiceContent(await response.json());
      if (content === null) {
        throw new Error('OpenRouter response missing choices[0].message.content');
      }
      return content;
    },
  };
}
