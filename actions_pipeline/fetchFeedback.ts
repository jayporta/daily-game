#!/usr/bin/env node
import type { HistoryGameEntry } from '#actions_pipeline/lib/historyStore.ts';
import { patchEntry } from '#actions_pipeline/lib/historyStore.ts';
import { type ReactionStoreParams, readTally } from '#actions_pipeline/lib/reactionStore.ts';
// Reconciles yesterday's reactions into yesterday's history entry.
//
// Every failure is non-fatal: an unreachable store, an error status or an
// unparseable body all leave history exactly as it was. Missing yesterday's
// reaction counts is a cosmetic loss; failing the daily run over it is not.
//
// Reading the store is `actions_pipeline/lib/reactionStore.ts`; turning what it
// answers into counts is `actions_pipeline/lib/reactionTally.ts`.
import { isPublishableSlug } from '#lib/reactionTypes.ts';

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
