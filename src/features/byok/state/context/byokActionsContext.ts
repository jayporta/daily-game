// Everything about a visitor's generation that does not change as it streams:
// what to call to start or stop one, and what the last one left behind.
import { createContext } from 'react';
import type { ByokResult } from '@/features/byok/state/context/byokResult.ts';
import type { ByokGenerateRequest, ByokGeneration } from '@/features/byok/state/useByok.ts';

/** The controls and the slow-moving state around a BYOK run. */
export interface ByokActions {
  /**
   * The visitor's own generation, shown in place of the day's game, or `null`
   * while the day's game is showing.
   */
  readonly override: ByokResult | null;
  /**
   * Corrective wording from the last failed run, for the next prompt.
   *
   * Exposed rather than applied here because the panel composes the prompt —
   * it is the only place that also knows whether the visitor asked to include
   * the current game.
   */
  readonly priorFailureFeedback: string | undefined;
  /** Runs one generation. Single attempt, no retry: it is the visitor's credits. */
  generate: (request: ByokGenerateRequest) => Promise<ByokGeneration | null>;
  /**
   * Ends the run in flight, leaving any earlier override on screen.
   *
   * What the Stop control does: it cancels the run the visitor just started
   * and returns them to whatever they were looking at, which may be their
   * own previous generation rather than the day's game.
   */
  stop: () => void;
  /**
   * Ends the run in flight *and* drops the override.
   *
   * The way back to the day's game. Both halves, because a retry that failed
   * after an earlier success would otherwise clear the run but leave the
   * stale override showing — needing a second click to actually get back.
   */
  backToTodaysGame: () => void;
  /** Drops the correction, for when the visitor picks a different model. */
  clearFeedback: () => void;
  /** Shows a finished generation in place of the day's game. */
  showResult: (result: ByokResult) => void;
}

/**
 * The controls, or `null` where no provider stands above the reader.
 *
 * Read it through {@link useByokActions}.
 */
export const ByokActionsContext = createContext<ByokActions | null>(null);
