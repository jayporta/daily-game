// What a failed BYOK run means: what the visitor is told, what the next
// attempt is told, and whether anyone should be paged about it.
//
// Kept out of useByok.ts because none of it needs React — this is the part
// worth testing exhaustively, and it runs under node --test as plain
// functions rather than through a rendered hook.
import { EXTRACTION_RETRY_FEEDBACK } from '../../../lib/extract-bundle-shared.ts';
import { isExpectedFailure } from './providers.ts';
import type { ExtractFailureReason } from '../../../lib/extract-bundle-shared.ts';
import type { ByokFailureKind, ByokStopReason } from './providers.ts';

/**
 * A run that did not produce a game, and which half of the call it failed in.
 *
 * `request` never reached a usable response; `response` arrived and could not
 * be read as a game. The distinction matters because only the second half has
 * anything to say to the model on a retry.
 */
export type ByokFailure =
  | { source: 'request'; kind: ByokFailureKind; message: string }
  | { source: 'response'; stop: ByokStopReason; reason: ExtractFailureReason };

export interface ByokFailureReport {
  /** End-user-facing wording, shown on the panel and in the console. */
  readonly message: string;
  /**
   * Corrective wording addressed to the model for the next attempt, or
   * `undefined` when the failure is not one a model can do anything about.
   */
  readonly retryNote: string | undefined;
  /**
   * Whether this is a defect rather than a normal consequence of using
   * someone else's key — the Sentry decision.
   */
  readonly worthReporting: boolean;
  /** Short, low-cardinality label for a log line and a Sentry tag. */
  readonly cause: string;
}

/**
 * End-user-facing copy for a response that arrived intact and still did not
 * parse — distinct from {@link EXTRACTION_RETRY_FEEDBACK}, which is addressed
 * to the model. "Try a different model" is honest advice only here: the model
 * really did ignore the output format.
 */
const EXTRACTION_MESSAGE: Record<ExtractFailureReason, string> = {
  'missing-meta-block': 'The response had no game details block. Try a different model.',
  'missing-html-block': 'The response had no game code block. Try a different model.',
  'invalid-json-meta': 'The response’s game details were not valid. Try a different model.',
  'empty-html': 'The response’s game code was empty. Try a different model.',
};

const TRUNCATED_MESSAGE =
  'The model ran out of room before it finished the game. Try a faster model, or clear “Include the current game’s code” to leave it more space.';

const REFUSED_MESSAGE =
  'The model declined to finish this game. Try a different model.';

const TRUNCATED_RETRY_NOTE =
  'Your previous response was cut off before it finished — you ran out of output space. Write a shorter, tighter game this time, and make sure both fenced blocks are closed.';

const REFUSED_RETRY_NOTE =
  'Your previous response was stopped by a content filter. Keep the game entirely inoffensive and try a different subject.';

/**
 * How a failed run should be explained, retried and recorded.
 *
 * The interesting case is a truncated response: extraction reports a missing
 * ```html block, because the closing fence is exactly what a cut-off response
 * loses. Reading the reason alone would blame the model's formatting for a
 * limit we set, so the stop reason wins wherever the two disagree.
 */
export function describeByokFailure(failure: ByokFailure): ByokFailureReport {
  if (failure.source === 'request') {
    return {
      message: failure.message,
      // Nothing here is addressed to a model: a rejected key, a rate limit or
      // an unreachable host describe the call, not the game.
      retryNote: undefined,
      worthReporting: !isExpectedFailure(failure.kind),
      cause: failure.kind,
    };
  }

  switch (failure.stop) {
    case 'truncated':
      // Ours to fix: the output cap is a number this app chose.
      return {
        message: TRUNCATED_MESSAGE,
        retryNote: TRUNCATED_RETRY_NOTE,
        worthReporting: true,
        cause: 'truncated',
      };
    case 'refused':
      return {
        message: REFUSED_MESSAGE,
        retryNote: REFUSED_RETRY_NOTE,
        worthReporting: false,
        cause: 'refused',
      };
    case 'complete':
      return {
        message: EXTRACTION_MESSAGE[failure.reason],
        retryNote: EXTRACTION_RETRY_FEEDBACK[failure.reason],
        worthReporting: false,
        cause: failure.reason,
      };
  }
}
