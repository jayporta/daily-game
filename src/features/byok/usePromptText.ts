import { useRef, useState } from 'react';
import { fetchText } from '#src/features/game/manifest-client.ts';
import { reportError } from '#src/lib/sentry.ts';
import { stripAttemptFeedback } from '#lib/attempt-feedback.ts';

/** What the disclosure shows about the day's prompt. */
export type PromptTextState =
  | { status: 'unrequested' }
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'failed' };

/** The state above, plus which path it describes. */
interface Progress {
  readonly path: string;
  readonly state: PromptTextState;
}

const UNREQUESTED: PromptTextState = { status: 'unrequested' };

export interface UsePromptTextResult {
  readonly state: PromptTextState;
  /**
   * Loads the prompt if it is not already loading or loaded.
   *
   * Safe to call from anything — opening the disclosure, reaching the form,
   * pressing Generate. The first call starts the fetch and every later one
   * joins it, so there is never more than one request per prompt.
   *
   * @returns The prompt text, or `null` if it could not be loaded.
   */
  load: () => Promise<string | null>;
}

/**
 * Loads the prompt that produced today's game, on demand, ready to re-send.
 *
 * The archived file records the attempt that actually succeeded, so it may
 * carry a correction addressed to the attempt before it. A visitor's run is
 * a fresh first attempt with nothing to correct, so that one section is
 * removed — see {@link stripAttemptFeedback}.
 *
 * Deferred rather than fetched with the page: most visitors never open this
 * panel, and the prompt is only needed to show it or to send it. Awaited at
 * submit time rather than gating the button, so a visitor who pastes a key
 * before it arrives is never left looking at a disabled control.
 *
 * @param promptPath Repo-relative path from the manifest.
 * @param fetchImpl Replaces global `fetch`; injected by tests.
 */
export function usePromptText(promptPath: string, fetchImpl?: typeof fetch): UsePromptTextResult {
  // Both the state and the in-flight request carry the path they belong to,
  // so a day rollover cannot show yesterday's prompt under today's game.
  //
  // No unmount guard: a request can outlive the panel, but since React 18 a
  // setState on an unmounted component is a silent no-op, so guarding it
  // would add a branch nothing can observe.
  const [progress, setProgress] = useState<Progress>({ path: promptPath, state: UNREQUESTED });
  const inFlight = useRef<{ path: string; promise: Promise<string | null> } | null>(null);

  const load = (): Promise<string | null> => {
    const existing = inFlight.current;
    if (existing !== null && existing.path === promptPath) return existing.promise;

    const path = promptPath;
    // Applied only while `path` is still the one being asked about. A
    // superseded request settles anyway — it is already in flight — and
    // without this it would overwrite its successor's answer, whichever of
    // the two lands first.
    const settle = (state: PromptTextState): void =>
      setProgress((previous) => (previous.path === path ? { path, state } : previous));

    setProgress({ path, state: { status: 'loading' } });
    const promise = fetchText(path, { fetchImpl }).then(
      (archived) => {
        // Stripped here, once, so the disclosure shows exactly what the
        // Generate button sends — the two must never diverge.
        const text = stripAttemptFeedback(archived);
        settle({ status: 'ready', text });
        return text;
      },
      (error: unknown) => {
        // A missing prompt disables the whole panel while the rest of the
        // page looks healthy, so nothing else would ever surface it.
        reportError(error, { area: 'byok', stage: 'prompt-fetch' });
        settle({ status: 'failed' });
        return null;
      },
    );
    inFlight.current = { path, promise };
    return promise;
  };

  // A path change with no `load` yet leaves `progress` describing the old
  // one; nothing is known about the new path until someone asks.
  return { state: progress.path === promptPath ? progress.state : UNREQUESTED, load };
}
