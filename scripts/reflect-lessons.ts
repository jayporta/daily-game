#!/usr/bin/env node
// Rewrites history/summary.json's "lessons" note from the hot window, each
// day, so the guidance in tomorrow's prompt reflects the last few weeks
// rather than games that aged out two months ago.
//
// Owns the lessons field outright. The rollup owns the archive and the
// tallies and makes no model call, so the two never write the same thing.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '#lib/errors.ts';
import { getOpenRouterClient } from '#scripts/lib/get-client.ts';
import { readHotWindow, readSummary } from '#scripts/lib/history-store.ts';
import {
  MAX_LESSONS_LENGTH,
  buildLessonsMessages,
} from '#scripts/lib/lessons-prompt.ts';
import { createPaths, paths as defaultPaths } from '#scripts/lib/paths.ts';
import type { OpenRouterClient } from '#scripts/lib/openrouter-client.ts';
import type { HistoryGameEntry, HistorySummary } from '#scripts/lib/history-store.ts';
import { loadModelsConfig } from '#scripts/lib/config/models.ts';

/**
 * Asks the model for a rewritten lessons note.
 *
 * @returns The new note, or `null` when the call fails or comes back empty.
 *   The caller keeps the existing note in that case: stale lessons cost the
 *   next prompt some polish, a failed rollup would cost the hot window its
 *   bound.
 */
export async function rewriteLessons(
  client: OpenRouterClient,
  {
    model,
    summary,
    aging,
  }: { model: string; summary: HistorySummary; aging: readonly HistoryGameEntry[] },
): Promise<string | null> {
  let raw: string;
  try {
    ({ text: raw } = await client.complete({
      model,
      messages: buildLessonsMessages(summary, aging),
      temperature: 0.3,
    }));
  } catch {
    return null;
  }

  const lessons = raw.trim().slice(0, MAX_LESSONS_LENGTH);
  return lessons.length > 0 ? lessons : null;
}

export interface ReflectOptions {
  client?: OpenRouterClient;
  /** Defaults to `moderationModel`, the project's non-generating model. */
  model?: string;
  /** Repo root to read and write — overridden in tests. */
  root?: string;
  /** Compute the new note, write nothing. */
  dryRun?: boolean;
}

/** What one reflection did. */
export interface ReflectResult {
  /** False when the model could not be reached, or there was nothing to read. */
  readonly rewritten: boolean;
  /** The note as it now stands, whether or not this run changed it. */
  readonly lessons: string;
}

/**
 * Distils the hot window into the lessons note.
 *
 * Best-effort in both directions: an empty history writes nothing, and an
 * unreachable model leaves the previous note in place. A stale note costs
 * tomorrow's prompt some polish; failing here must not cost the day its game.
 */
export async function reflectLessons({
  client,
  model,
  root,
  dryRun = false,
}: ReflectOptions = {}): Promise<ReflectResult> {
  const paths = root ? createPaths(root) : defaultPaths;
  const summary = readSummary(paths.historySummary);
  const entries = readHotWindow(paths.historyGames);

  if (entries.length === 0) return { rewritten: false, lessons: summary.lessons };

  const lessons = await rewriteLessons(client ?? getOpenRouterClient(), {
    model: model ?? loadModelsConfig(paths.modelsConfig).moderationModel,
    summary,
    aging: entries,
  });

  if (lessons === null || lessons === summary.lessons) {
    return { rewritten: false, lessons: summary.lessons };
  }
  if (dryRun) return { rewritten: true, lessons };

  const updated: HistorySummary = { ...summary, lessons };
  writeFileSync(paths.historySummary, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return { rewritten: true, lessons };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  reflectLessons({ dryRun })
    .then((result) => {
      const prefix = dryRun ? '[dry-run] ' : '';
      console.log(
        result.rewritten
          ? `${prefix}Lessons rewritten (${result.lessons.length} chars).`
          : 'Lessons left unchanged.',
      );
    })
    .catch((error: unknown) => {
      console.error(`Reflection failed: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
}
