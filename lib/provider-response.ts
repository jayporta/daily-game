// How an AI provider's HTTP response is read — the success payload and the
// error body alike.
//
// In lib/ because two callers need the identical reading, on opposite sides
// of the build: `scripts/lib/openrouter-client.ts` in the daily pipeline and
// `src/features/byok/providers.ts` in the browser. Both talk to the same
// OpenAI-shaped API, so both read a response the same way.
import { arrayAt, recordAt, stringAt } from '#lib/guards.ts';

/**
 * Cap on any provider text shown to a visitor or written to history.
 *
 * Error envelopes carry account identifiers — OpenRouter's `user_id`,
 * Supabase's project references — which have no business in the DOM or in
 * the public `history/games.json`.
 */
export const MAX_ERROR_DETAIL = 200;

/**
 * The assistant's text from an OpenAI-shaped completion response, read out of
 * `choices[0].message.content`.
 *
 * @returns The text, or `null` if the response is not shaped the way the API
 *   documents — which each caller turns into a retry or a visible error.
 */
export function firstChoiceContent(data: unknown): string | null {
  const choice: unknown = arrayAt(data, 'choices')?.[0];
  return stringAt(recordAt(choice, 'message'), 'content');
}

/**
 * One streamed fragment from an OpenAI-shaped response, read out of
 * `choices[0].delta.content`.
 *
 * The streaming twin of {@link firstChoiceContent}: the same envelope, with
 * the assistant's text arriving under `delta` instead of `message`.
 *
 * @returns The fragment, or `null` for a frame that carries none — the first
 *   frame announces the role and no text, and the last carries a finish
 *   reason. Neither is an error.
 */
export function firstChoiceDelta(data: unknown): string | null {
  const choice: unknown = arrayAt(data, 'choices')?.[0];
  return stringAt(recordAt(choice, 'delta'), 'content');
}

/**
 * The human-readable part of a failed response, truncated.
 *
 * Understands both envelope shapes providers use — `{"error": {"message":
 * "..."}}` and a bare `{"error": "..."}` — and falls back to the raw body
 * when it is not JSON at all.
 *
 * @param body The response body, already read as text.
 * @param maxLength Cap on the result. Applied to the extracted message as
 *   well as to the fallback body: a provider is free to return a very long
 *   message, and this string is shown or stored either way.
 */
export function errorDetail(body: string, maxLength: number = MAX_ERROR_DETAIL): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const error: unknown = recordAt(parsed, 'error') ?? stringAt(parsed, 'error');
    const message = typeof error === 'string' ? error : stringAt(error, 'message');
    if (message !== null) return message.slice(0, maxLength);
  } catch {
    // Not JSON. Fall through to the truncated body.
  }
  return body.slice(0, maxLength);
}

/** Reads the body of a failed response, then {@link errorDetail} on it. */
export async function responseErrorDetail(
  response: Response,
  maxLength: number = MAX_ERROR_DETAIL,
): Promise<string> {
  return errorDetail(await response.text().catch(() => ''), maxLength);
}
