// The retry/moderation/smoke-test control loop — the crux of both the
// safety and quality guarantees.
//
// Each attempt: pick a model → build a prompt (feeding back the previous
// attempt's specific failure) → generate → extract → moderate → smoke test.
// Exhausting the active model rotation is a normal outcome, not a CI failure;
// run-daily-pipeline.ts is what turns that into a run that keeps the game the
// site is already serving and still exits green.

import {
  buildPrompt,
  isPlaceholderMeta,
  selectRemixSuggestion,
} from '#actions_pipeline/build-prompt.ts';
import type { GenerationConfig } from '#actions_pipeline/lib/config/generation.ts';
import type { GenresConfig } from '#actions_pipeline/lib/config/genres.ts';
import type { ModelsConfig } from '#actions_pipeline/lib/config/models.ts';
import type {
  FailureKind,
  HistoryGameEntry,
  HistorySummary,
} from '#actions_pipeline/lib/history-store.ts';
import { isQuotaFailure, type OpenRouterClient } from '#actions_pipeline/lib/openrouter-client.ts';
import { moderate } from '#actions_pipeline/moderate.ts';
import { activeModels, selectNextModel } from '#actions_pipeline/select-model.ts';
import type { SmokeTester, SmokeTestResult } from '#actions_pipeline/smoke-test.ts';
import { errorMessage } from '#lib/errors.ts';
import type { GeneratedMeta } from '#lib/extract-bundle-shared.ts';
import { EXTRACTION_RETRY_FEEDBACK, extractBundle } from '#lib/extract-bundle-shared.ts';
import type { ProviderStopReason } from '#lib/provider-response.ts';
import { SYSTEM_PROMPT } from '#lib/system-prompt.ts';

/**
 * How many attempts a `forceModel` run gets.
 *
 * Only that path is bounded by a constant. An ordinary run attempts each
 * active model in `config/models.json` exactly once, so its attempt count is
 * the size of the rotation, not a number written down anywhere.
 */
export const FORCED_MODEL_ATTEMPTS = 3;

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

export type GenerateResult =
  | {
      status: 'success';
      meta: GeneratedMeta;
      html: string;
      model: string;
      attempts: number;
      /** Whether the game painted anything during the smoke test. */
      canvasDrawn: boolean;
      /** The exact user-turn prompt that produced this bundle — persisted by publish.ts. */
      prompt: string;
      /**
       * The same failures as `reasons` would describe on a failed run, as
       * closed-vocabulary ids, for every attempt before this one succeeded.
       * Empty when the first attempt won.
       */
      kinds: FailureKind[];
      /** The model each of those attempts used, parallel to `kinds` by index. */
      attemptModels: string[];
      /** Whether any of those attempts was refused for provider capacity. */
      quotaAffected: boolean;
    }
  | {
      status: 'failed_kept_previous';
      attempts: number;
      reasons: string[];
      /** The same failures as `reasons`, as closed-vocabulary ids. */
      kinds: FailureKind[];
      /** The model each attempt used, parallel to `kinds` by index. */
      attemptModels: string[];
      model: string;
      /**
       * Whether every attempt failed because the provider had no capacity
       * left, which is the one failure no retry and no other model can fix.
       */
      quotaExhausted: boolean;
      /**
       * Whether any attempt — not necessarily every one — was refused for
       * provider capacity.
       *
       * A superset of `quotaExhausted`: true whenever that is, and also true
       * on a day that failed for mixed reasons. `check-models.ts` skips a day
       * this flags entirely rather than only the exhausted case, so a model
       * that merely happened to run out the rotation's clock on a quota
       * refusal is not blamed for it as a `generation-call` failure.
       */
      quotaAffected: boolean;
    };

/**
 * Where a run's progress output goes.
 *
 * Injected rather than hardcoded so a test can silence a run. Several
 * exercise the every-attempt-failed path, whose reasons would otherwise land
 * in the test runner's own output.
 */
export type Logger = (message: string) => void;

/** What one attempt produced, as the loop needs to see it. */
type AttemptOutcome =
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
       * on purpose: this is what `check-models.ts`'s day-level reliability
       * gate reads, so an attempt whose moderation chain hit a 429 before a
       * fallback rejected the game on content grounds still excludes the
       * day, without inflating `quotaFailures` for a failure that was not
       * actually about capacity.
       */
      quotaAffected: boolean;
    };

interface AttemptParams {
  readonly client: OpenRouterClient;
  readonly model: string;
  readonly prompt: string;
  readonly guardrails: string;
  /** The catalogue the reported genre has to name one of. */
  readonly genres: GenresConfig;
  readonly moderationModel: string;
  /** Stand-in moderators, used only when {@link moderationModel} is unreachable. */
  readonly moderationFallbacks: readonly string[];
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
async function runAttempt({
  client,
  model,
  prompt,
  guardrails,
  genres,
  moderationModel,
  moderationFallbacks,
  temperature,
  smokeTester,
  log,
}: AttemptParams): Promise<AttemptOutcome> {
  let raw: string;
  let stop: ProviderStopReason;

  log('Requesting LLM generation...');
  try {
    ({ text: raw, stop } = await client.complete({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature,
    }));
    log(`Generation finished (Stop reason: ${stop})`);
  } catch (error) {
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

  const extracted = extractBundle(raw);
  log(`Bundle extraction: ${extracted.ok ? 'Success' : 'Failed'}`);

  if (!extracted.ok) {
    // A truncated response loses its closing fence first, which reads as a
    // missing block — naming the real cause here is what makes it
    // diagnosable from history/games.json alone.
    const truncatedNote = stop === 'truncated' ? ' (response truncated at the output cap)' : '';
    return {
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
    fallbackModels: moderationFallbacks,
  });

  if (!moderation.pass) {
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

  log('Running smoke test...');
  const smoke = await smokeTester.test(extracted.html);

  if (!smoke.pass) {
    return {
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
    ok: true,
    meta: extracted.meta,
    html: extracted.html,
    canvasDrawn: smoke.canvasDrawn,
    quotaAffected: moderation.quotaAffected,
  };
}

export interface GenerateDailyGameParams {
  client: OpenRouterClient;
  modelsConfig: ModelsConfig;
  genres: GenresConfig;
  guardrails: string;
  generationConfig: GenerationConfig;
  historyEntries: HistoryGameEntry[];
  summary: HistorySummary;
  smokeTester: SmokeTester;
  /** Logs each stage of every attempt. A hand-run debugging aid, off by default. */
  verbose?: boolean;
  /** Where `verbose` output goes. Defaults to `console.log`. */
  log?: Logger;
  /** Overrides model rotation entirely — used by the workflow's force_model input. */
  forceModel?: string;
  lastUsedModelId?: string;
  rng?: () => number;
  now?: Date;
}

export async function generateDailyGame({
  client,
  modelsConfig,
  genres,
  guardrails,
  generationConfig,
  historyEntries,
  summary,
  smokeTester,
  verbose = false,
  log: writeLog = console.log,
  forceModel,
  lastUsedModelId,
  rng = Math.random,
  now = new Date(),
}: GenerateDailyGameParams): Promise<GenerateResult> {
  const reasons: string[] = [];
  const kinds: FailureKind[] = [];
  const attemptModels: string[] = [];
  // Compared against the attempt total below: a run counts as quota-exhausted
  // only when no attempt failed for any other reason.
  let quotaFailures = 0;
  // Broader than quotaFailures: true once any attempt's moderation chain has
  // hit capacity anywhere along it, even an attempt whose actual failure (or
  // eventual success) had nothing to do with capacity. This is what feeds
  // the day's own quotaAffected — quotaFailures alone would miss a fallback
  // that judged past an earlier 429.
  let quotaAffected = false;
  let priorFailureFeedback: string | undefined;
  let model = forceModel ?? selectNextModel(modelsConfig, lastUsedModelId).id;
  const maxAttempts = forceModel ? FORCED_MODEL_ATTEMPTS : activeModels(modelsConfig).length;
  const log: Logger = verbose ? writeLog : () => undefined;

  const remixSuggestion = selectRemixSuggestion(summary, {
    remixProbability: generationConfig.remixProbability,
    remixLookbackDays: generationConfig.remixLookbackDays,
    rng,
    now,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log(`\n[Attempt ${attempt}/${maxAttempts}] Using model: ${model}`);

    const prompt = buildPrompt({
      guardrailsText: guardrails,
      genres,
      historyEntries,
      summary,
      remixSuggestion,
      priorFailureFeedback,
    });

    const outcome = await runAttempt({
      client,
      model,
      prompt,
      guardrails,
      genres,
      moderationModel: modelsConfig.moderationModel,
      // The rotation stands in when the dedicated moderator cannot be
      // reached, minus the model that wrote this bundle — nothing judges
      // its own work.
      moderationFallbacks: activeModels(modelsConfig)
        .map((entry) => entry.id)
        .filter((id) => id !== model && id !== modelsConfig.moderationModel)
        .slice(0, MAX_MODERATION_FALLBACKS),
      temperature: generationConfig.temperature,
      smokeTester,
      log: (message) => log(`[Attempt ${attempt}] ${message}`),
    });

    if (outcome.ok) {
      return {
        status: 'success',
        meta: outcome.meta,
        html: outcome.html,
        model,
        attempts: attempt,
        canvasDrawn: outcome.canvasDrawn,
        prompt,
        kinds: [...kinds],
        attemptModels: [...attemptModels],
        // Prior failed attempts aside, the winning attempt's own moderation
        // call can itself have been refused for capacity before a fallback
        // passed it — that still counts.
        quotaAffected: quotaAffected || outcome.quotaAffected,
      };
    }

    const reason = `attempt ${attempt} (${model}): ${outcome.reason}`;
    log(`[Attempt ${attempt}] ${reason}`);
    reasons.push(reason);
    kinds.push(outcome.kind);
    attemptModels.push(model);
    if (outcome.quota) quotaFailures += 1;
    if (outcome.quotaAffected) quotaAffected = true;
    priorFailureFeedback = outcome.feedback;
    model = nextModelAfterFailure(modelsConfig, model, forceModel);
  }

  return {
    status: 'failed_kept_previous',
    attempts: maxAttempts,
    reasons,
    kinds,
    attemptModels,
    model,
    quotaExhausted: quotaFailures === maxAttempts,
    quotaAffected,
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

/** Retrying on a different model gives a genuinely different roll of the dice. */
function nextModelAfterFailure(config: ModelsConfig, current: string, forceModel?: string): string {
  if (forceModel) return forceModel;
  return selectNextModel(config, current).id;
}
