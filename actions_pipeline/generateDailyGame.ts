// The retry/moderation/smoke-test control loop — the crux of both the
// safety and quality guarantees.
//
// Each attempt: pick a model → build a prompt (feeding back the previous
// attempt's specific failure) → run it (runAttempt.ts: generate → extract →
// moderate → smoke test) → record the outcome and rotate.
// Reaching every active model without a winner is a normal outcome, not a CI
// failure; runDailyPipeline.ts is what turns that into a run that keeps the
// game the site is already serving and still exits green.

import { buildPrompt, selectRemixSuggestion } from '#actions_pipeline/buildPrompt.ts';
import type { GenerateResult } from '#actions_pipeline/generateResult.ts';
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

/**
 * How many attempts a `forceModel` run gets.
 *
 * Only that path is bounded by a constant. An ordinary run reaches each
 * active model in `config/models.json` at most once, as a primary or a
 * fallback, so the size of the rotation caps its attempts and it can end
 * early.
 */
export const FORCED_MODEL_ATTEMPTS = 3;

/**
 * How many rotation models follow the primary in each generation request as
 * OpenRouter-side fallbacks.
 *
 * OpenRouter retries the request on the next one when the primary errors
 * before its stream starts, so an instant refusal (a 429, a 503, a delisted
 * model) costs no attempt: a delisted primary was measured failing over
 * within the same request in about half a second. Only the generation call
 * carries them; a `forceModel` run sends none.
 */
const GENERATION_FALLBACKS = 2;

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
  // The primary of the next attempt.
  let model = forceModel ?? selectNextModel(modelsConfig, lastUsedModelId).id;
  // Models an ordinary run has served from or failed over past; later
  // attempts neither pick nor list them.
  const reached = new Set<string>();
  let attemptsMade = 0;
  let lastServed: string | undefined;
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
    attemptsMade = attempt;
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
        : fallbackModelsAfter(modelsConfig, model, GENERATION_FALLBACKS, reached),
      moderationModel: modelsConfig.moderationModel,
      rotation: rotationIds,
      temperature: generationConfig.temperature,
      smokeTester,
      log: (message) => log(`[Attempt ${attempt}] ${message}`),
    });

    // Models OpenRouter skipped get a kind and a model, ahead of the attempt's
    // own outcome, on success too, but no reason: nothing was seen to fail.
    for (const skipped of outcome.failedOver) {
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
    lastServed = outcome.served;

    if (forceModel) continue;
    reached.add(outcome.served);
    for (const skipped of outcome.failedOver) reached.add(skipped);
    // The next primary is the first model nothing has reached; none left ends the run.
    const next = fallbackModelsAfter(modelsConfig, outcome.served, 1, reached)[0];
    if (next === undefined) break;
    model = next;
  }

  return {
    status: 'failed_kept_previous',
    attempts: attemptsMade,
    reasons,
    kinds,
    attemptModels,
    model: forceModel ?? selectNextModel(modelsConfig, lastServed).id,
    quotaExhausted: quotaFailures === attemptsMade,
    quotaAffected,
  };
}
