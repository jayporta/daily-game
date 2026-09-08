// One day's whole run: load config and history from disk, generate, and write
// down whatever came of it.
//
// Exhausting the active model rotation is a normal outcome, not a CI failure:
// the live site keeps the game it is already serving, and the run still exits
// green. The one write a failed run can make is repointing a manifest that has
// stopped naming a game at all back at the archive.
import { applyFeedback } from '#scripts/fetch-feedback.ts';
import { type GenerateResult, generateDailyGame } from '#scripts/generate-daily-game.ts';
import { loadAllConfig } from '#scripts/lib/config/index.ts';
import { loadReactionConfigOrUnconfigured } from '#scripts/lib/config/reactionConfig.ts';
import { getOpenRouterClient } from '#scripts/lib/get-client.ts';
import type { HistoryGameEntry } from '#scripts/lib/history-store.ts';
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
import type { ManifestRestoreResult } from '#scripts/publish.ts';
import {
  publish,
  recordFailure,
  restoreManifestFromArchive,
  writeRunStatus,
} from '#scripts/publish.ts';
import { createSmokeTester, type SmokeTester } from '#scripts/smoke-test.ts';

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
      quotaExhausted: result.quotaExhausted,
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
    // The one failure a visitor can act on, so the page is told to say so
    // rather than count down to a game that is not coming.
    if (result.quotaExhausted) {
      const status = writeRunStatus({
        date,
        generatedAt: now.toISOString(),
        cronSchedule: generation.cronSchedule,
        root,
      });
      console.log(`Out of OpenRouter quota — the site will say so until ${status.retryAt}`);
    }
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
