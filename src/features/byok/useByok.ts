import { useState } from 'react';
import { completeByok } from './providers.ts';
import { extractBundle } from '../../../lib/extract-bundle-shared.ts';
import type { ByokProvider } from '../../../lib/byok-config-types.ts';
import type { ExtractFailureReason, GeneratedMeta } from '../../../lib/extract-bundle-shared.ts';

/**
 * End-user-facing copy for a response that did not parse — distinct from the
 * model-corrective wording `call-openrouter.ts` uses for retries.
 */
const EXTRACTION_FEEDBACK: Record<ExtractFailureReason, string> = {
  'missing-meta-block': 'The response had no game details block. Try a different model.',
  'missing-html-block': 'The response had no game code block. Try a different model.',
  'invalid-json-meta': 'The response’s game details were not valid. Try a different model.',
  'empty-html': 'The response’s game code was empty. Try a different model.',
};

/**
 * What the panel renders.
 *
 * Carries no success case: a finished generation is handed straight back from
 * {@link UseByokResult.generate} and rendered by the page, not by the panel,
 * so holding it here would be state nothing reads.
 */
export type ByokStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string };

/** One completed generation, returned to the caller rather than stored. */
export interface ByokGeneration {
  readonly html: string;
  readonly meta: GeneratedMeta;
  /** Readable provider name, for the "generated just now via" line. */
  readonly providerLabel: string;
  readonly modelId: string;
}

export interface UseByokParams {
  /** The fixed system prompt, imported directly — never per-game. */
  readonly systemPrompt: string;
  /** Replaces global `fetch`; injected by tests. */
  readonly fetchImpl?: typeof fetch;
}

/** One generation's inputs. */
export interface ByokGenerateRequest {
  readonly provider: ByokProvider;
  readonly modelId: string;
  /** Readable provider name, carried through to the result. */
  readonly providerLabel: string;
  /**
   * The visitor's key. A parameter only — used inside this one call and
   * never assigned to hook state, so it cannot outlive it.
   */
  readonly apiKey: string;
  /** The exact prompt that produced today's published game. */
  readonly userPrompt: string;
}

export interface UseByokResult {
  readonly status: ByokStatus;
  /**
   * Runs one generation. Single attempt, no retry: it is the visitor's own
   * credits.
   *
   * @returns The generation, or `null` on failure — in which case
   *   {@link UseByokResult.status} carries the message to show.
   */
  generate: (request: ByokGenerateRequest) => Promise<ByokGeneration | null>;
}

export function useByok({ systemPrompt, fetchImpl }: UseByokParams): UseByokResult {
  // No unmount guard: a generation can outlive the panel if the visitor
  // navigates mid-request, but since React 18 a setState on an unmounted
  // component is a silent no-op, so guarding it would add a branch nothing
  // can observe.
  const [status, setStatus] = useState<ByokStatus>({ status: 'idle' });

  const generate = async ({
    provider,
    modelId,
    providerLabel,
    apiKey,
    userPrompt,
  }: ByokGenerateRequest): Promise<ByokGeneration | null> => {
    setStatus({ status: 'loading' });

    const completion = await completeByok(
      { provider, model: modelId, apiKey, systemPrompt, userPrompt },
      { fetchImpl },
    );
    if (!completion.ok) {
      setStatus({ status: 'error', message: completion.message });
      return null;
    }

    const extracted = extractBundle(completion.text);
    if (!extracted.ok) {
      setStatus({ status: 'error', message: EXTRACTION_FEEDBACK[extracted.reason] });
      return null;
    }

    setStatus({ status: 'idle' });
    return { html: extracted.html, meta: extracted.meta, providerLabel, modelId };
  };

  return { status, generate };
}
