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
 * `choices[0].finish_reason` from an OpenAI-shaped response — the
 * non-streaming counterpart to reading it off a stream's final frame.
 */
export function firstChoiceFinishReason(data: unknown): string | null {
  const choice: unknown = arrayAt(data, 'choices')?.[0];
  return stringAt(choice, 'finish_reason');
}

/**
 * Why a provider stopped producing text, read from the response's own
 * stop field rather than inferred from the text — a response cut off at
 * the output cap and one the model finished deliberately are
 * indistinguishable by inspection, and call for opposite advice.
 */
export type ProviderStopReason = 'complete' | 'truncated' | 'refused';

/**
 * Every spelling of "I ran out of room" and "I declined", across the
 * OpenAI-shaped, Anthropic and Gemini finish-reason vocabularies.
 *
 * Matched case-insensitively against one lowercased token so a caller needs
 * no per-provider branch.
 */
const TRUNCATED_STOPS: ReadonlySet<string> = new Set(['length', 'max_tokens', 'model_length']);
const REFUSED_STOPS: ReadonlySet<string> = new Set([
  'content_filter',
  'refusal',
  'safety',
  'recitation',
  'blocklist',
  'prohibited_content',
  'spii',
  'image_safety',
]);

/**
 * Classifies a provider's own stop token.
 *
 * @param raw The stop field as sent, in any case.
 * @returns `null` for a response or frame carrying no stop field, so a
 *   caller reading it frame by frame can keep the last one it saw rather
 *   than overwrite it with every intermediate frame.
 */
export function classifyStopReason(raw: string | null): ProviderStopReason | null {
  if (raw === null) return null;
  const token = raw.toLowerCase();
  if (TRUNCATED_STOPS.has(token)) return 'truncated';
  if (REFUSED_STOPS.has(token)) return 'refused';
  return 'complete';
}

/**
 * Output cap sent on every OpenRouter request, browser and pipeline alike.
 *
 * OpenRouter fronts small free models, some of which apply their own low
 * default when asked for none at all, or spend part of a larger one on
 * reasoning before ever reaching the two fenced blocks the prompt asks for.
 * A request with no cap leaves that decision to the provider, and a
 * provider whose default lands short of a full game silently truncates
 * mid-document rather than erroring — the exact shape of both the BYOK
 * Gemini truncation and the daily pipeline's `missing-html-block` failures.
 * One constant, so `src/features/byok/providers.ts` and
 * `scripts/lib/openrouter-client.ts` can never drift apart on it.
 */
export const OPENROUTER_MAX_OUTPUT_TOKENS = 16000;

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
