#!/usr/bin/env node
// The retry/moderation/smoke-test control loop — the crux of both the
// safety and quality guarantees.
//
// Each attempt: pick a model → build a prompt (feeding back the previous
// attempt's specific failure) → generate → extract → moderate → smoke
// test. Exhausting the active model rotation is a normal outcome, not a CI
// failure: a live site keeps the game it is already serving, and the run still
// exits green. The one write a failed run can make is repointing a manifest
// that has stopped naming a game at all back at the archive.
import { pathToFileURL } from 'node:url';
import { errorMessage } from '#lib/errors.ts';
import type { GeneratedMeta } from '#lib/extract-bundle-shared.ts';
import { EXTRACTION_RETRY_FEEDBACK, extractBundle } from '#lib/extract-bundle-shared.ts';
import type { ProviderStopReason } from '#lib/provider-response.ts';
import { SYSTEM_PROMPT } from '#lib/system-prompt.ts';
import { buildPrompt, selectRemixSuggestion } from '#scripts/build-prompt.ts';
import { applyFeedback } from '#scripts/fetch-feedback.ts';
import type { GenerationConfig } from '#scripts/lib/config/generation.ts';
import type { GenresConfig } from '#scripts/lib/config/genres.ts';
import { loadAllConfig } from '#scripts/lib/config/index.ts';
import type { ModelsConfig } from '#scripts/lib/config/models.ts';
import { loadReactionConfigOrUnconfigured } from '#scripts/lib/config/reactionConfig.ts';
import { getOpenRouterClient } from '#scripts/lib/get-client.ts';
import type { FailureKind, HistoryGameEntry, HistorySummary } from '#scripts/lib/history-store.ts';
import {
  lastPublishedEntry,
  publishedEntryOn,
  readHotWindow,
  readSummary,
  writeGamesJson,
  writeGamesMd,
} from '#scripts/lib/history-store.ts';
import type { OpenRouterClient } from '#scripts/lib/openrouter-client.ts';
import { createPaths, type Paths, paths } from '#scripts/lib/paths.ts';
import { moderate } from '#scripts/moderate.ts';
import type { ManifestRestoreResult } from '#scripts/publish.ts';
import { publish, recordFailure, restoreManifestFromArchive } from '#scripts/publish.ts';
import { activeModels, selectNextModel } from '#scripts/select-model.ts';
import { createSmokeTester, type SmokeTester, type SmokeTestResult } from '#scripts/smoke-test.ts';

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

/**
 * What a whole pipeline run produced.
 *
 * Wider than {@link GenerateResult}: the run can also stop before generating
 * anything, which generation itself has no way to report.
 */
export type PipelineResult =
  | GenerateResult
  | {
      /**
       * Today already had a game, so nothing was generated. A successful,
       * green run that writes no history entry of its own.
       */
      status: 'already_published';
      /** The slug already serving for today. */
      slug: string;
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
      reasons.push(
        `attempt ${attempt} (${model}): moderation rejected — ${moderation.reasons.join('; ')}`,
      );
      kinds.push('moderation');
      if (verbose) {
        console.log(`[Attempt ${attempt}] Moderation failed: ${moderation.reasons.join('; ')}`);
      }
      priorFailureFeedback = `Your previous game violated the content rules: ${moderation.reasons.join('; ')}. Re-read the content rules and avoid this entirely.`;
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

function todayISODate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export interface RunDailyPipelineOptions {
  dryRun?: boolean;
  forceModel?: string;
  /** Logs each stage of every attempt. A hand-run debugging aid, off by default. */
  verbose?: boolean;
  now?: Date;
  /** Overrides the repo root, so tests read and write a scratch directory. */
  root?: string;
  /** Overrides the real-or-mock client {@link getOpenRouterClient} would pick. */
  client?: OpenRouterClient;
  /**
   * A caller-supplied tester is the caller's to close; only one this function
   * creates itself is closed here.
   */
  smokeTester?: SmokeTester;
}

/**
 * Fills in the previous game's reaction counts and writes them to disk.
 *
 * Best-effort in every direction: the config loader degrades to
 * unconfigured rather than throwing on a bad hand-edit, and
 * `applyFeedback` returns the entries unchanged when the store is unset or
 * unreachable. Nothing here can cost the day its game.
 */
async function reconcileYesterday(
  entries: HistoryGameEntry[],
  dryRun: boolean,
  currentPaths: Paths,
): Promise<HistoryGameEntry[]> {
  const previous = lastPublishedEntry(entries);
  if (previous?.slug === undefined) return entries;

  const reconciled = await applyFeedback(entries, {
    slug: previous.slug,
    endpointUrl: loadReactionConfigOrUnconfigured().endpointUrl,
    // Privileged, and deliberately not read from any committed file.
    apiKey: process.env['REACTION_STORE_KEY'] ?? null,
  });

  if (reconciled !== entries && !dryRun) {
    writeGamesJson(currentPaths.historyGames, reconciled);
    writeGamesMd(currentPaths.historyGamesMd, reconciled);
  }
  return reconciled;
}

/** Loads real config/history from disk, generates, and publishes on success. */
export async function runDailyPipeline({
  dryRun = false,
  verbose = false,
  forceModel,
  now = new Date(),
  root,
  client: suppliedClient,
  smokeTester: suppliedSmokeTester,
}: RunDailyPipelineOptions = {}): Promise<PipelineResult> {
  const currentPaths = root ? createPaths(root) : paths;
  const { models, genres, generation, guardrails } = loadAllConfig(root);
  const summary = readSummary(currentPaths.historySummary);
  const date = todayISODate(now);

  // Reconciled before anything can fail: a generation that later gives up
  // must still leave yesterday's reactions recorded.
  const historyEntries = await reconcileYesterday(
    readHotWindow(currentPaths.historyGames),
    dryRun,
    currentPaths,
  );

  // Two triggers reach this day on purpose — a punctual external dispatch and
  // the Actions schedule behind it — and a dispatch can also be retried. Only
  // the first to publish does the work; the rest stop here. They still run the
  // reconcile above, which on a second run refreshes the counts for today's
  // own game rather than yesterday's, since that is now the newest published
  // entry. Harmless, and it picks up the reactions earned since publishing.
  const today = publishedEntryOn(historyEntries, date);
  if (today?.slug !== undefined) {
    console.log(`${date} is already published as ${today.slug} — nothing to generate`);
    return { status: 'already_published', slug: today.slug };
  }

  const client = suppliedClient ?? getOpenRouterClient();
  const smokeTester = suppliedSmokeTester ?? (await createSmokeTester());

  let result: GenerateResult;
  try {
    result = await generateDailyGame({
      client,
      modelsConfig: models,
      genres,
      guardrails,
      generationConfig: generation,
      historyEntries,
      summary,
      verbose,
      smokeTester,
      forceModel,
      lastUsedModelId: lastPublishedEntry(historyEntries)?.model,
      now,
    });
  } finally {
    if (suppliedSmokeTester === undefined) await smokeTester.close();
  }

  if (dryRun) {
    console.log(`[dry-run] ${result.status} — nothing written to disk`);
    return result;
  }

  if (result.status === 'success') {
    const published = publish({
      date,
      meta: result.meta,
      html: result.html,
      model: result.model,
      attempts: result.attempts,
      canvasDrawn: result.canvasDrawn,
      prompt: result.prompt,
      generationConfig: generation,
      genres,
      historyEntries,
      generatedAt: now.toISOString(),
      root,
    });
    console.log(
      `Published ${published.slug} (model ${result.model}, ${result.attempts} attempt(s))`,
    );
  } else {
    const recorded = recordFailure({
      date,
      model: result.model,
      attempts: result.attempts,
      reasons: result.reasons,
      kinds: result.kinds,
      historyEntries,
      root,
    });
    // Keeping the previous manifest only serves a game while it still names
    // one. A seed-state or dangling manifest is repointed at the newest
    // archived day so a failed run never leaves the site with nothing.
    const restored = restoreManifestFromArchive({
      historyEntries: recorded,
      generationConfig: generation,
      genres,
      root,
    });
    console.log(`All ${result.attempts} attempts failed — ${describeRestore(restored)}. Reasons:`);
    for (const reason of result.reasons) console.log(`  - ${reason}`);
  }

  return result;
}

/** How a failed run reports what the site is left showing. */
function describeRestore(restored: ManifestRestoreResult): string {
  switch (restored.status) {
    case 'intact':
      return 'previous game kept';
    case 'restored':
      return `manifest restored to ${restored.manifest.slug} from the archive`;
    case 'no-candidate':
      return 'no game to keep — the archive holds none';
  }
}

const FORCE_MODEL_FLAG = '--force-model=';

function parseCliArgs(argv: string[]): RunDailyPipelineOptions {
  const forceModelArg = argv.find((arg) => arg.startsWith(FORCE_MODEL_FLAG));
  // Slice rather than split('=') so a model id containing '=' survives intact.
  const forceModel = forceModelArg?.slice(FORCE_MODEL_FLAG.length);
  return {
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose'),
    ...(forceModel ? { forceModel } : {}),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A failed generation is a normal outcome and must still exit green;
  // only an unexpected crash is a real CI failure.
  runDailyPipeline(parseCliArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error('Pipeline crashed:', error);
    process.exitCode = 1;
  });
}
