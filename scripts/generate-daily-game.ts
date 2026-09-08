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
import { isQuotaFailure, type OpenRouterClient } from '#scripts/lib/openrouter-client.ts';
import { moderate } from '#scripts/moderate.ts';
import { activeModels, selectNextModel } from '#scripts/select-model.ts';
import type { SmokeTester, SmokeTestResult } from '#scripts/smoke-test.ts';

/**
 * How many attempts a `forceModel` run gets.
 *
 * Only that path is bounded by a constant. An ordinary run attempts each
 * active model in `config/models.json` exactly once, so its attempt count is
 * the size of the rotation, not a number written down anywhere.
 */
export const FORCED_MODEL_ATTEMPTS = 3;

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
      /**
       * Whether every attempt failed because the provider had no capacity
       * left, which is the one failure no retry and no other model can fix.
       */
      quotaExhausted: boolean;
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
    }
  | {
      ok: false;
      kind: FailureKind;
      /** Unprefixed — the loop adds the attempt number and model. */
      reason: string;
      /** What to tell the next attempt, or `undefined` to tell it nothing. */
      feedback: string | undefined;
      /** Whether this was the provider having no capacity left. */
      quota: boolean;
    };

interface AttemptParams {
  readonly client: OpenRouterClient;
  readonly model: string;
  readonly prompt: string;
  readonly guardrails: string;
  readonly moderationModel: string;
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
  moderationModel,
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
    return {
      ok: false,
      kind: 'generation-call',
      reason: `generation call failed — ${errorMessage(error)}`,
      feedback:
        'The previous request failed before returning a game. Return the two fenced blocks exactly as specified.',
      quota: isQuotaFailure(error),
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
    };
  }

  log('Running moderation...');
  const moderation = await moderate(client, {
    meta: extracted.meta,
    html: extracted.html,
    guardrailsText: guardrails,
    moderationModel,
  });

  if (!moderation.pass) {
    const detail = moderation.reasons.join('; ');
    const unreachable = moderation.failure === 'call-failed';
    return {
      ok: false,
      kind: unreachable ? 'generation-call' : 'moderation',
      // A failed call's detail already names itself; only a verdict needs a label.
      reason: unreachable ? detail : `moderation rejected — ${detail}`,
      // A moderator that never answered judged nothing, so the model is told
      // nothing: guidance about content rules would describe a violation that
      // was never found.
      feedback: unreachable
        ? undefined
        : `Your previous game violated the content rules: ${detail}. Re-read the content rules and avoid this entirely.`,
      quota: false,
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
      quota: false,
    };
  }

  return { ok: true, meta: extracted.meta, html: extracted.html, canvasDrawn: smoke.canvasDrawn };
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
  // Compared against the attempt total below: a run counts as quota-exhausted
  // only when no attempt failed for any other reason.
  let quotaFailures = 0;
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
      moderationModel: modelsConfig.moderationModel,
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
      };
    }

    const reason = `attempt ${attempt} (${model}): ${outcome.reason}`;
    log(`[Attempt ${attempt}] ${reason}`);
    reasons.push(reason);
    kinds.push(outcome.kind);
    if (outcome.quota) quotaFailures += 1;
    priorFailureFeedback = outcome.feedback;
    model = nextModelAfterFailure(modelsConfig, model, forceModel);
  }

  return {
    status: 'failed_kept_previous',
    attempts: maxAttempts,
    reasons,
    kinds,
    model,
    quotaExhausted: quotaFailures === maxAttempts,
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
  return 'smoke-load';
}

/** Retrying on a different model gives a genuinely different roll of the dice. */
function nextModelAfterFailure(config: ModelsConfig, current: string, forceModel?: string): string {
  if (forceModel) return forceModel;
  return selectNextModel(config, current).id;
}
