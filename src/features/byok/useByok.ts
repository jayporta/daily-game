import { useRef, useState } from 'react';
import { completeByok } from '#src/features/byok/providers.ts';
import { describeByokFailure, type ByokFailure } from '#src/features/byok/byokFailure.ts';
import { useGenerationStream } from '#src/features/byok/useGenerationStream.ts';
import { reportError } from '#src/lib/sentry.ts';
import { errorMessage } from '#lib/errors.ts';
import { extractBundle } from '#lib/extract-bundle-shared.ts';
import type { ByokProvider } from '#lib/byok-config-types.ts';
import type { GeneratedMeta } from '#lib/extract-bundle-shared.ts';

/**
 * What the page renders while a visitor's own generation runs.
 *
 * Carries no success case: a finished generation is handed straight back from
 * {@link UseByokResult.generate} and rendered as a game, so holding it here
 * would be state nothing reads.
 *
 * `streaming` and `error` both carry `output` — the model's raw text as far
 * as it got — because a run that fails part-way is exactly when seeing what
 * it did say matters most.
 */
export type ByokStatus =
  | { status: 'idle' }
  | { status: 'streaming'; run: ByokRun; output: string }
  | { status: 'error'; run: ByokRun; message: string; output: string };

/** Which provider and model a run is using, for the console's header. */
export interface ByokRun {
  readonly providerLabel: string;
  readonly modelId: string;
}

/** One completed generation, returned to the caller rather than stored. */
export interface ByokGeneration {
  readonly html: string;
  readonly meta: GeneratedMeta;
  /** Readable provider name, for the "generated just now via" line. */
  readonly providerLabel: string;
  readonly modelId: string;
}

/** What {@link useByok} needs for every run it will make. */
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
   * Corrective wording from the last failed run, for the next prompt.
   *
   * Exposed rather than applied here because the panel composes the prompt —
   * it is the only place that also knows whether the visitor asked to include
   * the current game.
   */
  readonly priorFailureFeedback: string | undefined;
  /**
   * Drops that correction.
   *
   * The panel calls this when the visitor picks a different model: a note
   * describing what the last model got wrong is not addressed to a model that
   * has not tried yet. Clearing beats remembering which model earned it —
   * there is then no model identity to keep in step with the menus.
   */
  clearFeedback: () => void;
  /**
   * Ends the current run and returns to the day's game.
   *
   * Serves both the Stop control during a run and the way back after a
   * failed one, because they want the same thing: drop the output, abort
   * anything still in flight so a long generation is not left running
   * against the visitor's credits, and show the game again. Neither reports
   * a failure — the visitor asked for this.
   *
   * A successful run needs no such control: it leaves on its own, replaced
   * by the game it produced.
   */
  stop: () => void;
  /**
   * Runs one generation. Single attempt, no retry: it is the visitor's own
   * credits.
   *
   * @returns The generation, or `null` on failure — in which case
   *   {@link UseByokResult.status} carries the message to show.
   */
  generate: (request: ByokGenerateRequest) => Promise<ByokGeneration | null>;
}

/**
 * Runs a visitor's own generation against their own API key.
 *
 * Owned above the panel that starts it, because the live output renders in
 * the game's place rather than inside the panel.
 *
 * Holds no finished game and no key: a completed run is handed straight back
 * from {@link UseByokResult.generate}, and the key is a parameter of that one
 * call. What it does hold is the lifecycle, the streamed text, and the
 * correction a failed run leaves for the next attempt.
 */
export function useByok({ systemPrompt, fetchImpl }: UseByokParams): UseByokResult {
  // No unmount guard: a generation can outlive the panel if the visitor
  // navigates mid-request, but since React 18 a setState on an unmounted
  // component is a silent no-op, so guarding it would add a branch nothing
  // can observe.
  const [phase, setPhase] = useState<Phase>({ phase: 'idle' });
  const [priorFailureFeedback, setPriorFailureFeedback] = useState<string | undefined>(undefined);
  const stream = useGenerationStream();
  // Identifies the run in flight. A stopped or superseded run still settles —
  // its request is already out — and without this its late failure would
  // overwrite the state the visitor is now looking at.
  const currentRun = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const stop = (): void => {
    currentRun.current += 1;
    abort.current?.abort();
    abort.current = null;
    stream.reset();
    setPhase({ phase: 'idle' });
  };

  const generate = async ({
    provider,
    modelId,
    providerLabel,
    apiKey,
    userPrompt,
  }: ByokGenerateRequest): Promise<ByokGeneration | null> => {
    const run: ByokRun = { providerLabel, modelId };
    const id = currentRun.current + 1;
    currentRun.current = id;
    const controller = new AbortController();
    abort.current = controller;

    stream.reset();
    setPhase({ phase: 'streaming', run });

    // Explains the failure, records it, and leaves the panel showing why.
    const fail = (failure: ByokFailure): null => {
      const report = describeByokFailure(failure);

      // Local diagnosis only. Console breadcrumbs are dropped before they
      // reach Sentry (see `sentryOptions`), because `report.message` can
      // carry the provider's verbatim error body.
      console.error(`[byok] ${provider}/${modelId} failed (${report.cause}): ${report.message}`);
      if (report.worthReporting) {
        // Identifies the shape of the failure and nothing else — no key, no
        // prompt, and none of the model's output.
        reportError(new Error(`BYOK generation failed: ${report.cause}`), {
          area: 'byok',
          provider,
          model: modelId,
          cause: report.cause,
        });
      }

      setPriorFailureFeedback(report.retryNote);
      setPhase({ phase: 'error', run, message: report.message });
      return null;
    };

    try {
      const completion = await completeByok(
        { provider, model: modelId, apiKey, systemPrompt, userPrompt },
        { fetchImpl, onDelta: stream.append, signal: controller.signal },
      );

      // Stopped, or replaced by a newer run, while this one was in flight.
      if (currentRun.current !== id) return null;

      // The run is over, so the tail is shown now rather than at the next
      // frame that may never come.
      stream.flush();

      if (!completion.ok) {
        return fail({ source: 'request', kind: completion.kind, message: completion.message });
      }

      // A run cut short still parses when the model closed both fences in
      // time, and a game that extracted is a game worth playing however it
      // ended.
      const extracted = extractBundle(completion.text);
      if (!extracted.ok) {
        return fail({ source: 'response', stop: completion.stop, reason: extracted.reason });
      }

      setPriorFailureFeedback(undefined);
      setPhase({ phase: 'idle' });
      return { html: extracted.html, meta: extracted.meta, providerLabel, modelId };
    } catch (error) {
      // A defect on our side of the call rather than a provider's answer.
      // Without this the phase would stay `streaming` and the panel would
      // show a spinner that never stops.
      if (currentRun.current !== id) return null;
      stream.flush();
      return fail({ source: 'request', kind: 'provider', message: errorMessage(error) });
    }
  };

  return {
    status: toStatus(phase, stream.output),
    priorFailureFeedback,
    clearFeedback: () => setPriorFailureFeedback(undefined),
    generate,
    stop,
  };
}

/** The lifecycle alone. The output is the stream's, and is joined on below. */
type Phase =
  | { phase: 'idle' }
  | { phase: 'streaming'; run: ByokRun }
  | { phase: 'error'; run: ByokRun; message: string };

/**
 * Joins the lifecycle to the text received so far.
 *
 * Kept apart in state so a fragment arriving does not have to rewrite the
 * phase, and the phase changing does not have to carry the text along.
 */
function toStatus(phase: Phase, output: string): ByokStatus {
  switch (phase.phase) {
    case 'idle':
      return { status: 'idle' };
    case 'streaming':
      return { status: 'streaming', run: phase.run, output };
    case 'error':
      return { status: 'error', run: phase.run, message: phase.message, output };
  }
}
