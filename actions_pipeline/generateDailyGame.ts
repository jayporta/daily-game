// The retry/moderation/smoke-test control loop — the crux of both the
// safety and quality guarantees.
//
// Each attempt: pick a model → build a prompt (feeding back the previous
// attempt's specific failure) → run it (runAttempt.ts: generate → extract →
// moderate → smoke test) → record the outcome and rotate.
// Exhausting the active model rotation is a normal outcome, not a CI failure;
// runDailyPipeline.ts is what turns that into a run that keeps the game the
// site is already serving and still exits green.

import { buildPrompt, selectRemixSuggestion } from '#actions_pipeline/buildPrompt.ts';
import type { GenerationConfig } from '#actions_pipeline/lib/config/generation.ts';
import type { GenresConfig } from '#actions_pipeline/lib/config/genres.ts';
import type { ModelsConfig } from '#actions_pipeline/lib/config/models.ts';
import type {
  FailureKind,
  HistoryGameEntry,
  HistorySummary,
} from '#actions_pipeline/lib/historyStore.ts';
import type { OpenRouterClient } from '#actions_pipeline/lib/openRouterClient.ts';
import { type Logger, runAttempt } from '#actions_pipeline/runAttempt.ts';
import {
  activeModels,
  fallbackModelsAfter,
  selectNextModel,
} from '#actions_pipeline/selectModel.ts';
import type { SmokeTester } from '#actions_pipeline/smokeTest.ts';
import type { GeneratedMeta } from '#lib/extractBundleShared.ts';

/**
 * How many attempts a `forceModel` run gets.
 *
 * Only that path is bounded by a constant. An ordinary run makes one attempt
 * per active model in `config/models.json`, so its attempt count is the size
 * of the rotation, not a number written down anywhere.
 */
export const FORCED_MODEL_ATTEMPTS = 3;

/**
 * How many rotation models follow the primary in each generation request as
 * OpenRouter-side fallbacks.
 *
 * OpenRouter retries the request on the next one when the primary errors
 * before its stream starts, so an instant refusal (a 429, a 503, a delisted
 * model) no longer costs a whole attempt. Only the generation call carries
 * them; a `forceModel` run sends none.
 */
export const GENERATION_FALLBACKS = 2;

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
       * Empty when the first attempt won on the model it asked for.
       *
       * One attempt can contribute more than one record: each model that
       * failed over to a fallback within it has a `generation-failover`
       * record of its own, so a first attempt served by a fallback is not
       * empty.
       */
      kinds: FailureKind[];
      /**
       * The model each of those records is charged to, parallel to `kinds` by
       * index. A failed-over model appears here ahead of the one that served.
       */
      attemptModels: string[];
      /** Whether any of those attempts was refused for provider capacity. */
      quotaAffected: boolean;
    }
  | {
      status: 'failed_kept_previous';
      attempts: number;
      reasons: string[];
      /**
       * The same failures as `reasons`, as closed-vocabulary ids. One attempt
       * can contribute more than one record: each model that failed over to a
       * fallback within it has a `generation-failover` record of its own.
       */
      kinds: FailureKind[];
      /**
       * The model each record is charged to, parallel to `kinds` by index. A
       * failed-over model appears here ahead of the one that served.
       */
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
       * on a day that failed for mixed reasons. `checkModels.ts` skips a day
       * this flags entirely rather than only the exhausted case, so a model
       * that merely happened to run out the rotation's clock on a quota
       * refusal is not blamed for it as a `generation-call` failure.
       */
      quotaAffected: boolean;
    };

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
  const rotationIds = activeModels(modelsConfig).map((entry) => entry.id);
  const maxAttempts = forceModel ? FORCED_MODEL_ATTEMPTS : rotationIds.length;
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
      fallbackModels: forceModel
        ? []
        : fallbackModelsAfter(modelsConfig, model, GENERATION_FALLBACKS),
      moderationModel: modelsConfig.moderationModel,
      rotation: rotationIds,
      temperature: generationConfig.temperature,
      smokeTester,
      log: (message) => log(`[Attempt ${attempt}] ${message}`),
    });

    // Models OpenRouter skipped on the way to the one that answered. They get
    // records of their own, ahead of the attempt's own outcome, on success too.
    for (const skipped of outcome.failedOver) {
      const skippedReason = `attempt ${attempt} (${skipped}): did not answer; served by ${outcome.served}`;
      log(`[Attempt ${attempt}] ${skippedReason}`);
      reasons.push(skippedReason);
      kinds.push('generation-failover');
      attemptModels.push(skipped);
    }

    if (outcome.ok) {
      return {
        status: 'success',
        meta: outcome.meta,
        html: outcome.html,
        model: outcome.served,
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

    const reason = `attempt ${attempt} (${outcome.served}): ${outcome.reason}`;
    log(`[Attempt ${attempt}] ${reason}`);
    reasons.push(reason);
    kinds.push(outcome.kind);
    attemptModels.push(outcome.served);
    if (outcome.quota) quotaFailures += 1;
    if (outcome.quotaAffected) quotaAffected = true;
    priorFailureFeedback = outcome.feedback;
    model = nextModelAfterFailure(modelsConfig, outcome.served, forceModel);
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

/** Retrying on a different model gives a genuinely different roll of the dice. */
function nextModelAfterFailure(config: ModelsConfig, current: string, forceModel?: string): string {
  if (forceModel) return forceModel;
  return selectNextModel(config, current).id;
}
