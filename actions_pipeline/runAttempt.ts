// One model's turn at a game: generate, extract, check the metadata,
// moderate, smoke test. The loop that rotates models and records failures
// around it lives in generateDailyGame.ts.

import { isPlaceholderMeta } from '#actions_pipeline/buildPrompt.ts';
import type { GenresConfig } from '#actions_pipeline/lib/config/genres.ts';
import type { FailureKind } from '#actions_pipeline/lib/historyStore.ts';
import { isQuotaFailure, type OpenRouterClient } from '#actions_pipeline/lib/openRouterClient.ts';
import { moderate } from '#actions_pipeline/moderate.ts';
import type { SmokeTester, SmokeTestResult } from '#actions_pipeline/smokeTest.ts';
import { errorMessage } from '#lib/errors.ts';
import type { GeneratedMeta } from '#lib/extractBundleShared.ts';
import { EXTRACTION_RETRY_FEEDBACK, extractBundle } from '#lib/extractBundleShared.ts';
import type { ProviderStopReason } from '#lib/providerResponse.ts';
import { SYSTEM_PROMPT } from '#lib/systemPrompt.ts';

/**
 * Where a run's progress output goes.
 *
 * Injected rather than hardcoded so a test can silence a run. Several
 * exercise the every-attempt-failed path, whose reasons would otherwise land
 * in the test runner's own output.
 */
export type Logger = (message: string) => void;

/**
 * How many stand-in moderators one attempt may try after the dedicated one
 * fails to answer.
 *
 * Bounded because each gets its own timeout: the rotation is the attempt
 * count, so an unbounded chain multiplies the two and a run of hung
 * moderators would overrun the workflow's cap before it could record
 * `failed_kept_previous`. A 429 — the case this exists for — fails
 * immediately and never approaches that.
 */
export const MAX_MODERATION_FALLBACKS = 2;

/** Which models an attempt's generation call went through. */
interface AttemptProvenance {
  /**
   * The model that answered, which is the primary unless the call threw or
   * OpenRouter failed over. Everything from extraction onwards is charged to it.
   */
  readonly served: string;
  /** Requested models ahead of {@link served} that did not answer, in request order. */
  readonly failedOver: readonly string[];
}

/** What one attempt produced, as the loop needs to see it. */
type AttemptOutcome = AttemptProvenance &
  (
    | {
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
    | {
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
  );

interface AttemptParams {
  readonly client: OpenRouterClient;
  readonly model: string;
  readonly prompt: string;
  readonly guardrails: string;
  /** The catalogue the reported genre has to name one of. */
  readonly genres: GenresConfig;
  /** OpenRouter-side fallbacks for the generation call; see `GENERATION_FALLBACKS`. */
  readonly fallbackModels: readonly string[];
  readonly moderationModel: string;
  /**
   * Every id in the active rotation. Stand-in moderators are drawn from it,
   * minus every model requested for the generation, and used only when
   * {@link moderationModel} is unreachable.
   */
  readonly rotation: readonly string[];
  readonly temperature: number;
  readonly smokeTester: SmokeTester;
  /** Already bound to this attempt's number by the loop. */
  readonly log: Logger;
}

/**
 * One model's turn: generate, extract, moderate, smoke test.
 *
 * Every rejection is an ordinary outcome rather than a throw, so the loop
 * that calls this has one place to record a failure and rotate the model.
 */
export async function runAttempt({
  client,
  model,
  prompt,
  guardrails,
  genres,
  fallbackModels,
  moderationModel,
  rotation,
  temperature,
  smokeTester,
  log,
}: AttemptParams): Promise<AttemptOutcome> {
  let raw: string;
  let stop: ProviderStopReason;
  let served: string;
  const requested = [model, ...fallbackModels];

  log('Requesting LLM generation...');
  try {
    ({
      text: raw,
      stop,
      model: served,
    } = await client.complete({
      model,
      fallbackModels,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature,
    }));
    if (served !== model) log(`served by ${served} (fallback from ${model})`);
    log(`Generation finished (Stop reason: ${stop})`);
  } catch (error) {
    const quota = isQuotaFailure(error);
    return {
      served: model,
      failedOver: [],
      ok: false,
      kind: 'generation-call',
      reason: `generation call failed — ${errorMessage(error)}`,
      feedback:
        'The previous request failed before returning a game. Return the two fenced blocks exactly as specified.',
      quota,
      quotaAffected: quota,
    };
  }

  const servedAt = requested.indexOf(served);
  const provenance: AttemptProvenance = {
    served,
    failedOver: servedAt === -1 ? [] : requested.slice(0, servedAt),
  };

  const extracted = extractBundle(raw);
  log(`Bundle extraction: ${extracted.ok ? 'Success' : 'Failed'}`);

  if (!extracted.ok) {
    // A truncated response loses its closing fence first, which reads as a
    // missing block — naming the real cause here is what makes it
    // diagnosable from history/games.json alone.
    const truncatedNote = stop === 'truncated' ? ' (response truncated at the output cap)' : '';
    return {
      ...provenance,
      ok: false,
      kind: 'extract',
      reason: `could not extract bundle — ${extracted.reason}${truncatedNote}`,
      feedback: EXTRACTION_RETRY_FEEDBACK[extracted.reason],
      quota: false,
      quotaAffected: false,
    };
  }

  // The one field of the model's metadata with a fixed vocabulary, so the
  // one that can be checked outright. A response that leaves the output
  // format's example in place fails here rather than publishing as "...".
  if (!genres.some((genre) => genre.id === extracted.meta.genre)) {
    return {
      ...provenance,
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

  // The rest of the metadata has no fixed vocabulary, so it is checked here
  // for the literal example text instead. A model can pair a real genre id
  // with an otherwise-unfilled example — and a game that paints a static
  // overlay still passes the smoke test's render check — so this is what
  // catches it.
  if (isPlaceholderMeta(extracted.meta)) {
    return {
      ...provenance,
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

  log('Running moderation...');
  const moderation = await moderate(client, {
    meta: extracted.meta,
    html: extracted.html,
    guardrailsText: guardrails,
    moderationModel,
    // Nothing judges its own work, and a served id that resolved to the
    // primary cannot rule out that a fallback wrote it, so every requested
    // model is left out of the stand-ins. With three or fewer active models
    // none remain, and an unreachable dedicated moderator fails the attempt
    // closed.
    fallbackModels: rotation
      .filter((id) => !requested.includes(id) && id !== moderationModel)
      .slice(0, MAX_MODERATION_FALLBACKS),
  });

  if (!moderation.pass) {
    const detail = moderation.reasons.join('; ');
    const unreachable = moderation.failure === 'call-failed';
    return {
      ...provenance,
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

  log('Running smoke test...');
  const smoke = await smokeTester.test(extracted.html);

  if (!smoke.pass) {
    return {
      ...provenance,
      ok: false,
      kind: smokeFailureKind(smoke),
      reason: `smoke test failed — ${smoke.reasons.join('; ')}`,
      feedback: `Your previous game did not run correctly: ${smoke.reasons.join('; ')}. Be more defensive — guard every element lookup, and make no network requests of any kind.`,
      // The smoke test itself is never a capacity issue — this attempt's
      // actual failure was not about capacity, even if moderation (already
      // passed, above) hit one on its way to a verdict.
      quota: false,
      quotaAffected: moderation.quotaAffected,
    };
  }

  return {
    ...provenance,
    ok: true,
    meta: extracted.meta,
    html: extracted.html,
    canvasDrawn: smoke.canvasDrawn,
    quotaAffected: moderation.quotaAffected,
  };
}

/**
 * Which closed-vocabulary kind a smoke-test rejection was.
 *
 * The result can carry more than one problem; the most specific wins, since
 * that is what the corrective guidance keys off.
 */
function smokeFailureKind(smoke: SmokeTestResult): FailureKind {
  if (smoke.networkAttempts.length > 0) return 'smoke-network';
  if (smoke.pageErrors.length > 0 || smoke.consoleErrors.length > 0) return 'smoke-js-error';
  // Checked after the two above, which describe a page that ran badly rather
  // than one that ran cleanly and drew nothing.
  if (!smoke.renderedSomething) return 'smoke-blank';
  return 'smoke-load';
}
