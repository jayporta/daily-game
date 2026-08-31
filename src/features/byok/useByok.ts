import { useState } from 'react';
import { completeByok } from './providers.ts';
import { extractBundle } from '../../../lib/extract-bundle-shared.ts';
import type { ByokProvider } from '../../../lib/byok-config-types.ts';
import type { ExtractFailureReason, GeneratedMeta } from '../../../lib/extract-bundle-shared.ts';

/** End-user-facing copy for a response that did not parse — distinct from
 * the model-corrective wording `call-openrouter.ts` uses for retries. */
const EXTRACTION_FEEDBACK: Record<ExtractFailureReason, string> = {
  'missing-meta-block': 'The response had no game details block. Try a different model.',
  'missing-html-block': 'The response had no game code block. Try a different model.',
  'invalid-json-meta': 'The response’s game details were not valid. Try a different model.',
  'empty-html': 'The response’s game code was empty. Try a different model.',
};

export type ByokStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; html: string; meta: GeneratedMeta; providerLabel: string; modelId: string }
  | { status: 'error'; message: string };

export interface UseByokParams {
  /** The fixed system prompt, imported directly — never per-game. */
  readonly systemPrompt: string;
  /** The exact prompt that produced today's published game. */
  readonly userPrompt: string;
  /** Replaces global `fetch`; injected by tests. */
  readonly fetchImpl?: typeof fetch;
}

export interface UseByokResult {
  readonly status: ByokStatus;
  /**
   * Runs one generation. `apiKey` is a parameter only — used inside this
   * one call and never assigned to hook state, so it cannot outlive it.
   * Single attempt, no retry: it is the visitor's own credits.
   */
  generate: (
    provider: ByokProvider,
    modelId: string,
    providerLabel: string,
    apiKey: string,
  ) => Promise<ByokStatus>;
  /** Returns to `idle`. Used to dismiss a result, not to recover from an error. */
  reset: () => void;
}

export function useByok({ systemPrompt, userPrompt, fetchImpl }: UseByokParams): UseByokResult {
  const [status, setStatus] = useState<ByokStatus>({ status: 'idle' });

  const generate = async (
    provider: ByokProvider,
    modelId: string,
    providerLabel: string,
    apiKey: string,
  ): Promise<ByokStatus> => {
    setStatus({ status: 'loading' });

    const completion = await completeByok(
      { provider, model: modelId, apiKey, systemPrompt, userPrompt },
      { fetchImpl },
    );
    if (!completion.ok) {
      const next: ByokStatus = { status: 'error', message: completion.message };
      setStatus(next);
      return next;
    }

    const extracted = extractBundle(completion.text);
    if (!extracted.ok) {
      const next: ByokStatus = { status: 'error', message: EXTRACTION_FEEDBACK[extracted.reason] };
      setStatus(next);
      return next;
    }

    const next: ByokStatus = {
      status: 'ready',
      html: extracted.html,
      meta: extracted.meta,
      providerLabel,
      modelId,
    };
    setStatus(next);
    return next;
  };

  const reset = (): void => setStatus({ status: 'idle' });

  return { status, generate, reset };
}
