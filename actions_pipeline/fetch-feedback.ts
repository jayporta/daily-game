#!/usr/bin/env node
// Reconciles yesterday's reactions into yesterday's history entry.
//
// Every failure is non-fatal: an unreachable store, an error status or an
// unparseable body all leave history exactly as it was. Missing yesterday's
// reaction counts is a cosmetic loss; failing the daily run over it is not.
//
// Reading the store is `actions_pipeline/lib/reaction-store.ts`; turning what it
// answers into counts is `actions_pipeline/lib/reaction-tally.ts`.
import type { HistoryGameEntry } from '#actions_pipeline/lib/history-store.ts';
import { patchEntry } from '#actions_pipeline/lib/history-store.ts';
import { type ReactionStoreParams, readTally } from '#actions_pipeline/lib/reaction-store.ts';
import { isPublishableSlug } from '#lib/reaction-types.ts';

/**
 * Returns `entries` with `slug`'s reaction counts filled in.
 *
 * Returns them unchanged — never throws — when no store is configured, the
 * slug is not one this project could have published, or the store cannot be
 * read.
 */
export async function applyFeedback(
  entries: HistoryGameEntry[],
  params: ReactionStoreParams,
): Promise<HistoryGameEntry[]> {
  if (!isPublishableSlug(params.slug)) return entries;

  const tally = await readTally(params);
  if (tally === null) return entries;

  const { likes, dislikes, dislikeReasons } = tally;
  return patchEntry(entries, params.slug, {
    likes,
    dislikes,
    dislikeReasons,
    popularityScore: likes - dislikes,
  });
}
