// The retry/moderation/smoke-test control loop — the crux of both the
// safety and quality guarantees.
//
// Each attempt: pick a model → build a prompt (feeding back the previous
// attempt's specific failure) → generate → extract → moderate → smoke test.
// Exhausting the active model rotation is a normal outcome, not a CI failure;
// run-daily-pipeline.ts is what turns that into a run that keeps the game the
// site is already serving and still exits green.
import { errorMessage } from '#lib/errors.ts';
import type { GeneratedMeta } from '#lib/extract-bundle-shared.ts';
import { EXTRACTION_RETRY_FEEDBACK, extractBundle } from '#lib/extract-bundle-shared.ts';
import type { ProviderStopReason } from '#lib/provider-response.ts';
import { SYSTEM_PROMPT } from '#lib/system-prompt.ts';
import { buildPrompt, selectRemixSuggestion } from '#scripts/build-prompt.ts';
import type { GenerationConfig } from '#scripts/lib/config/generation.ts';
import type { GenresConfig } from '#scripts/lib/config/genres.ts';
import type { ModelsConfig } from '#scripts/lib/config/models.ts';
import type { FailureKind, HistoryGameEntry, HistorySummary } from '#scripts/lib/history-store.ts';
import type { OpenRouterClient } from '#scripts/lib/openrouter-client.ts';
import { moderate } from '#scripts/moderate.ts';
import { activeModels, selectNextModel } from '#scripts/select-model.ts';
import type { SmokeTester, SmokeTestResult } from '#scripts/smoke-test.ts';

export const MAX_ATTEMPTS = 3;

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
    }
  | {
      status: 'failed_kept_previous';
      attempts: number;
      reasons: string[];
      /** The same failures as `reasons`, as closed-vocabulary ids. */
      kinds: FailureKind[];
      model: string;
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
  forceModel,
  lastUsedModelId,
  rng = Math.random,
  now = new Date(),
}: GenerateDailyGameParams): Promise<GenerateResult> {
  const reasons: string[] = [];
  const kinds: FailureKind[] = [];
  let priorFailureFeedback: string | undefined;
  let model = forceModel ?? selectNextModel(modelsConfig, lastUsedModelId).id;
  const maxAttempts = forceModel ? MAX_ATTEMPTS : activeModels(modelsConfig).length;

  const remixSuggestion = selectRemixSuggestion(summary, {
    remixProbability: generationConfig.remixProbability,
    remixLookbackDays: generationConfig.remixLookbackDays,
    rng,
    now,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (verbose) {
      console.log(`\n[Attempt ${attempt}/${maxAttempts}] Using model: ${model}`);
    }

    const temperature =
      generationConfig.retryTemperatures[attempt - 1] ??
      generationConfig.retryTemperatures.at(-1) ??
      0.7;

    const prompt = buildPrompt({
      guardrailsText: guardrails,
      genres,
      historyEntries,
      summary,
      remixSuggestion,
      priorFailureFeedback,
    });

    let raw: string;
    let stop: ProviderStopReason;

    if (verbose) {
      console.log(`[Attempt ${attempt}] Requesting LLM generation...`);
    }

    try {
      ({ text: raw, stop } = await client.complete({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature,
      }));

      if (verbose) {
        console.log(`[Attempt ${attempt}] Generation finished (Stop reason: ${stop})`);
      }
    } catch (error) {
      const reason = `attempt ${attempt} (${model}): generation call failed — ${errorMessage(error)}`;
      reasons.push(reason);
      kinds.push('generation-call');
      if (verbose) {
        console.log(`[Attempt ${attempt}] ${reason}`);
      }
      priorFailureFeedback =
        'The previous request failed before returning a game. Return the two fenced blocks exactly as specified.';
      model = nextModelAfterFailure(modelsConfig, model, forceModel);
      continue;
    }

    const extracted = extractBundle(raw);

    if (verbose) {
      console.log(`[Attempt ${attempt}] Bundle extraction: ${extracted.ok ? 'Success' : 'Failed'}`);
    }

    if (!extracted.ok) {
      // A truncated response loses its closing fence first, which reads as
      // a missing block — naming the real cause here is what makes it
      // diagnosable from history/games.json alone.
      const truncatedNote = stop === 'truncated' ? ' (response truncated at the output cap)' : '';
      reasons.push(
        `attempt ${attempt} (${model}): could not extract bundle — ${extracted.reason}${truncatedNote}`,
      );
      kinds.push('extract');
      priorFailureFeedback = EXTRACTION_RETRY_FEEDBACK[extracted.reason];
      model = nextModelAfterFailure(modelsConfig, model, forceModel);
      continue;
    }

    if (verbose) {
      console.log(`[Attempt ${attempt}] Running moderation...`);
    }

    const moderation = await moderate(client, {
      meta: extracted.meta,
      html: extracted.html,
      guardrailsText: guardrails,
      moderationModel: modelsConfig.moderationModel,
    });
    if (!moderation.pass) {
      const detail = moderation.reasons.join('; ');
      const unreachable = moderation.failure === 'call-failed';
      // A failed call's detail already names itself; only a verdict needs a label.
      reasons.push(
        unreachable
          ? `attempt ${attempt} (${model}): ${detail}`
          : `attempt ${attempt} (${model}): moderation rejected — ${detail}`,
      );
      kinds.push(unreachable ? 'generation-call' : 'moderation');
      if (verbose) {
        console.log(`[Attempt ${attempt}] Moderation failed: ${detail}`);
      }
      // A moderator that never answered judged nothing, so the model is told
      // nothing: guidance about content rules would describe a violation that
      // was never found.
      priorFailureFeedback = unreachable
        ? undefined
        : `Your previous game violated the content rules: ${detail}. Re-read the content rules and avoid this entirely.`;
      model = nextModelAfterFailure(modelsConfig, model, forceModel);
      continue;
    }

    if (verbose) {
      console.log(`[Attempt ${attempt}] Running smoke test...`);
    }

    const smoke = await smokeTester.test(extracted.html);
    if (!smoke.pass) {
      reasons.push(
        `attempt ${attempt} (${model}): smoke test failed — ${smoke.reasons.join('; ')}`,
      );
      kinds.push(smokeFailureKind(smoke));
      priorFailureFeedback = `Your previous game did not run correctly: ${smoke.reasons.join('; ')}. Be more defensive — guard every element lookup, and make no network requests of any kind.`;
      model = nextModelAfterFailure(modelsConfig, model, forceModel);
      continue;
    }

    return {
      status: 'success',
      meta: extracted.meta,
      html: extracted.html,
      model,
      attempts: attempt,
      canvasDrawn: smoke.canvasDrawn,
      prompt,
    };
  }

  return { status: 'failed_kept_previous', attempts: maxAttempts, reasons, kinds, model };
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
  return 'smoke-load';
}

/** Retrying on a different model gives a genuinely different roll of the dice. */
function nextModelAfterFailure(config: ModelsConfig, current: string, forceModel?: string): string {
  if (forceModel) return forceModel;
  return selectNextModel(config, current).id;
}
