#!/usr/bin/env node
// Reconciles yesterday's reactions into yesterday's history entry.
//
// The rows this reads come from a store that anyone who finds the public
// insert key can write to, so nothing here trusts them. The tally is built
// by iterating the closed reason vocabulary and counting matches — never by
// iterating keys from the response — so the output can only ever be
// integers under known ids. No string from the network reaches
// history/games.json, history/games.md, or the generation prompt.
//
// Every failure is non-fatal: an unreachable store, an error status or an
// unparseable body all leave history exactly as it was. Missing yesterday's
// reaction counts is a cosmetic loss; failing the daily run over it is not.
//
// The store is one table, whose schema is generated from this app's own
// vocabulary by scripts/reaction-store-schema.ts — run that to provision
// it. Its constraints, not the checks in the browser, are what actually
// bound what can be stored: anyone who loads the page holds the insert
// key. Verify RLS is ON and that the anon key can neither select nor
// update; the front-end never reads, so a select that returns
// rows means the policy is wrong. RLS with no select policy answers 200
// with an empty array rather than an error, so the status alone proves
// nothing. The privileged read key belongs in REACTION_STORE_KEY and must
// never be committed.
import { DISLIKE_REASONS, isPublishableSlug, type DislikeReason } from '../lib/reaction-types.ts';
import { patchEntry } from './lib/history-store.ts';
import type { HistoryGameEntry } from './lib/types.ts';

/** Reaction counts for one game. Integers only, by construction. */
export interface ReactionTally {
  /** Rows for this slug that said `like`. */
  readonly likes: number;
  /** Rows for this slug that said `dislike`, whether or not they gave reasons. */
  readonly dislikes: number;
  /** Counts keyed by {@link DislikeReason}, on a null-prototype object. */
  readonly dislikeReasons: Partial<Record<DislikeReason, number>>;
}

function emptyReasonCounts(): Partial<Record<DislikeReason, number>> {
  // Null-prototype: a row naming `__proto__` or `constructor` can then only
  // ever create an ordinary own property, never reach Object.prototype.
  return Object.create(null) as Partial<Record<DislikeReason, number>>;
}

/**
 * Counts one game's rows.
 *
 * @param rows Whatever the store returned. Any shape is tolerated.
 * @param slug Only rows carrying exactly this slug are counted.
 */
export function tallyReactions(rows: unknown, slug: string): ReactionTally {
  const dislikeReasons = emptyReasonCounts();
  let likes = 0;
  let dislikes = 0;

  if (!Array.isArray(rows)) return { likes, dislikes, dislikeReasons };

  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    if (!('slug' in row) || row.slug !== slug) continue;
    if (!('reaction' in row)) continue;

    if (row.reaction === 'like') {
      likes += 1;
      continue;
    }
    if (row.reaction !== 'dislike') continue;
    dislikes += 1;

    const reasons: unknown = 'reasons' in row ? row.reasons : undefined;
    if (!Array.isArray(reasons)) continue;

    // Iterate the vocabulary, not the row: a row cannot introduce a key,
    // and repeating one a thousand times still counts once.
    for (const reason of DISLIKE_REASONS) {
      if (reasons.includes(reason.id)) {
        dislikeReasons[reason.id] = (dislikeReasons[reason.id] ?? 0) + 1;
      }
    }
  }

  return { likes, dislikes, dislikeReasons };
}

export interface ApplyFeedbackParams {
  /** The game to reconcile — normally yesterday's. */
  slug: string;
  /** Reaction store REST endpoint, or `null` when none is configured. */
  endpointUrl: string | null;
  /**
   * The privileged read key, from an Actions secret — never the public
   * insert key that ships in the page.
   */
  apiKey: string | null;
  /** Replaces global `fetch`; injected by tests. */
  fetchImpl?: typeof fetch;
}

/** Asks the store for one game's rows, or `null` if it could not be asked. */
async function readRows({
  slug,
  endpointUrl,
  apiKey,
  fetchImpl = fetch,
}: ApplyFeedbackParams): Promise<unknown> {
  if (endpointUrl === null) return null;

  const url = `${endpointUrl}?slug=eq.${encodeURIComponent(slug)}&select=slug,reaction,reasons`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey !== null) {
    headers['apikey'] = apiKey;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetchImpl(url, { headers, cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Returns `entries` with `slug`'s reaction counts filled in.
 *
 * Returns them unchanged — never throws — when no store is configured, the
 * slug is not one this project could have published, or the store cannot be
 * read.
 */
export async function applyFeedback(
  entries: HistoryGameEntry[],
  params: ApplyFeedbackParams,
): Promise<HistoryGameEntry[]> {
  if (!isPublishableSlug(params.slug)) return entries;

  const rows = await readRows(params);
  if (rows === null) return entries;

  const { likes, dislikes, dislikeReasons } = tallyReactions(rows, params.slug);
  return patchEntry(entries, params.slug, {
    likes,
    dislikes,
    dislikeReasons,
    popularityScore: likes - dislikes,
  });
}
