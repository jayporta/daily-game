// What one attempt produced, and how each way of being rejected reads: the
// closed-vocabulary kind, the recorded reason and the feedback for the next
// attempt. The attempt itself runs in runAttempt.ts.

import type { FailureKind } from '#actions_pipeline/lib/historyStore.ts';
import { isQuotaFailure } from '#actions_pipeline/lib/openRouterClient.ts';
import type { ModerationResult } from '#actions_pipeline/moderate.ts';
import { SMOKE_REMEDIES } from '#actions_pipeline/prompt/correctiveDirectives.ts';
import type { SmokeTestResult } from '#actions_pipeline/smokeTest.ts';
import { errorMessage } from '#lib/errors.ts';
import type { ExtractFailureReason, GeneratedMeta } from '#lib/extractBundleShared.ts';
import { EXTRACTION_RETRY_FEEDBACK } from '#lib/extractBundleShared.ts';

/** Which models an attempt's generation call went through. */
export interface AttemptProvenance {
  /**
   * The model that answered, which is the primary unless OpenRouter failed
   * over. A call that threw is charged to the primary. Everything from
   * extraction onwards is charged to it.
   */
  readonly served: string;
  /** Requested models ahead of {@link served} that did not answer, in request order. */
  readonly failedOver: readonly string[];
}

/** An attempt that produced a game. */
interface AttemptSuccess {
  ok: true;
  meta: GeneratedMeta;
  html: string;
  /** Whether the game painted anything during the smoke test. */
  canvasDrawn: boolean;
  /**
   * Whether a moderation call along the way was refused for provider
   * capacity, even though the attempt went on to succeed.
   */
  quotaAffected: boolean;
}

/** An attempt that was turned down at some stage. */
export interface AttemptRejection {
  ok: false;
  kind: FailureKind;
  /** Unprefixed — the loop adds the attempt number and model. */
  reason: string;
  /** What to tell the next attempt, or `undefined` to tell it nothing. */
  feedback: string | undefined;
  /**
   * Whether the failure named by `kind` was itself a capacity refusal —
   * the precise signal `quotaFailures` counts. Never true when `kind`
   * has some other cause, even if a call earlier in this attempt (a
   * moderation fallback chain, say) did hit capacity; see
   * `quotaAffected` for that broader question.
   */
  quota: boolean;
  /**
   * Whether any provider call this attempt made — not necessarily the
   * one `kind` names — was refused for capacity. Broader than `quota`
   * on purpose: this is what `checkModels.ts`'s day-level reliability
   * gate reads, so an attempt whose moderation chain hit a 429 before a
   * fallback rejected the game on content grounds still excludes the
   * day, without inflating `quotaFailures` for a failure that was not
   * actually about capacity.
   */
  quotaAffected: boolean;
}

/** What one attempt produced, as the loop needs to see it. */
export type AttemptOutcome = AttemptProvenance & (AttemptSuccess | AttemptRejection);

/** The generation call threw before returning a game. */
export function generationCallRejection(error: unknown): AttemptRejection {
  const quota = isQuotaFailure(error);
  return {
    ok: false,
    kind: 'generation-call',
    reason: `generation call failed — ${errorMessage(error)}`,
    feedback:
      'The previous request failed before returning a game. Return the two fenced blocks exactly as specified.',
    quota,
    quotaAffected: quota,
  };
}

/**
 * The response held no bundle to extract.
 *
 * @param truncated Whether the response ended at the output cap. A truncated
 *   response loses its closing fence first, which reads as a missing block, so
 *   naming the real cause is what makes it diagnosable from
 *   history/games.json alone.
 */
export function extractRejection(
  reason: ExtractFailureReason,
  truncated: boolean,
): AttemptRejection {
  return {
    ok: false,
    kind: 'extract',
    reason: `could not extract bundle — ${reason}${truncated ? ' (response truncated at the output cap)' : ''}`,
    feedback: EXTRACTION_RETRY_FEEDBACK[reason],
    quota: false,
    quotaAffected: false,
  };
}

/** The reported genre is not one of the catalogue's ids. */
export function unknownGenreRejection(): AttemptRejection {
  return {
    ok: false,
    kind: 'unknown-genre',
    reason: 'reported a genre that is not in the catalogue',
    feedback:
      'Your previous game named a genre that is not in the catalogue. Use one of the listed ' +
      'genre ids exactly, copied from the list above.',
    quota: false,
    quotaAffected: false,
  };
}

/** The metadata still holds the output format's example values. */
export function placeholderMetaRejection(): AttemptRejection {
  return {
    ok: false,
    kind: 'placeholder-meta',
    reason: "echoed the output format's placeholder metadata instead of describing the game",
    feedback:
      'Your previous game left the output format\'s example values ("...") in the json ' +
      'block. Every field — title, theme, mechanics, controls — must describe the real ' +
      'game you built, not the example.',
    quota: false,
    quotaAffected: false,
  };
}

/** The page's script is a placeholder or stub, not the game's code. */
export function placeholderScriptRejection(): AttemptRejection {
  return {
    ok: false,
    kind: 'placeholder-script',
    reason: "returned a placeholder script instead of the game's code",
    feedback:
      "Your previous game's script was a placeholder or stub, not the game. Write the " +
      'complete game script with every function in full, and never leave a comment ' +
      'standing in for code.',
    quota: false,
    quotaAffected: false,
  };
}

/** Moderation turned the game down, or never answered. */
export function moderationRejection(
  moderation: Extract<ModerationResult, { pass: false }>,
): AttemptRejection {
  const detail = moderation.reasons.join('; ');
  const unreachable = moderation.failure === 'call-failed';
  return {
    ok: false,
    kind: unreachable ? 'moderation-unreachable' : 'moderation',
    // A failed call's detail already names itself; only a verdict needs a label.
    reason: unreachable ? detail : `moderation rejected — ${detail}`,
    // A moderator that never answered judged nothing, so the model is told
    // nothing: guidance about content rules would describe a violation that
    // was never found.
    feedback: unreachable
      ? undefined
      : `Your previous game violated the content rules: ${detail}. Re-read the content rules and avoid this entirely.`,
    quota: moderation.quota,
    quotaAffected: moderation.quotaAffected,
  };
}

/** The kinds a smoke-test rejection can be. */
type SmokeFailureKind = Extract<FailureKind, `smoke-${string}`>;

/** Corrective words for every way the smoke test turns a game down that has no remedy of its own. */
const SMOKE_DEFAULT_GUIDANCE =
  'Be more defensive — guard every element lookup, and make no network requests of any kind.';

/**
 * The corrective words that fit each kind of smoke-test rejection, or
 * `undefined` when nothing was seen to correct.
 */
const SMOKE_GUIDANCE: Record<SmokeFailureKind, string | undefined> = {
  'smoke-js-error': SMOKE_DEFAULT_GUIDANCE,
  'smoke-network': SMOKE_DEFAULT_GUIDANCE,
  'smoke-load': SMOKE_DEFAULT_GUIDANCE,
  'smoke-blank': SMOKE_REMEDIES['smoke-blank'],
  'smoke-inert': SMOKE_REMEDIES['smoke-inert'],
  'smoke-unresponsive': SMOKE_REMEDIES['smoke-unresponsive'],
  'smoke-unobserved': undefined,
};

/**
 * The smoke test turned the game down.
 *
 * @param moderationQuotaAffected Whether moderation, already passed, hit a
 *   capacity refusal on its way to a verdict. The smoke test itself is never a
 *   capacity issue, so this attempt's own failure is never about capacity.
 */
export function smokeRejection(
  smoke: SmokeTestResult,
  moderationQuotaAffected: boolean,
): AttemptRejection {
  const kind = smokeFailureKind(smoke);
  const guidance = SMOKE_GUIDANCE[kind];
  const detail = smoke.reasons.join('; ');
  return {
    ok: false,
    kind,
    reason: `smoke test failed — ${detail}`,
    // A page nobody could examine was judged on nothing, so the model is
    // told nothing: any guidance would describe a fault that was never seen.
    feedback:
      guidance === undefined
        ? undefined
        : `Your previous game did not run correctly: ${detail}. ${guidance}`,
    quota: false,
    quotaAffected: moderationQuotaAffected,
  };
}

/**
 * Which closed-vocabulary kind a smoke-test rejection was.
 *
 * The result can carry more than one problem; the most specific wins, since
 * that is what the corrective guidance keys off.
 */
function smokeFailureKind(smoke: SmokeTestResult): SmokeFailureKind {
  if (smoke.networkAttempts.length > 0) return 'smoke-network';
  if (smoke.pageErrors.length > 0 || smoke.consoleErrors.length > 0) return 'smoke-js-error';
  // Checked after the two above, which describe a page that ran badly rather
  // than one the run never got to look at.
  switch (smoke.reach) {
    case 'not-loaded':
      return 'smoke-load';
    case 'unobserved':
      return 'smoke-unobserved';
    case 'observed':
      // Before the render fields: a page that hung while being read never
      // showed what it rendered.
      if (smoke.activity === 'unresponsive') return 'smoke-unresponsive';
      if (!smoke.renderedSomething) return 'smoke-blank';
      // Nothing above rejected it, so the probe did.
      return 'smoke-inert';
  }
}
