// What a game's reactions add up to, and how to derive that from either shape
// the store answers with: raw rows, or one row of the aggregate view.
//
// Anyone who finds the public insert key can write those rows, so nothing here
// trusts them. Both derivations iterate the closed reason vocabulary and count
// matches — never the keys of a response — so the output can only ever be
// integers under known ids. No string from the network reaches
// history/games.json, history/games.md, or the generation prompt.
import { isRecord } from '#lib/guards.ts';
import { DISLIKE_REASONS, type DislikeReason } from '#lib/reaction-types.ts';

/** Reaction counts for one game. Integers only, by construction. */
export interface ReactionTally {
  /** Rows for this slug that said `like`. */
  readonly likes: number;
  /** Rows for this slug that said `dislike`, whether or not they gave reasons. */
  readonly dislikes: number;
  /** Counts keyed by {@link DislikeReason}. Only ids from that vocabulary appear. */
  readonly dislikeReasons: Partial<Record<DislikeReason, number>>;
}

/** A game the store holds no rows for. */
export const NO_REACTIONS: ReactionTally = { likes: 0, dislikes: 0, dislikeReasons: {} };

/**
 * Counts one game's rows.
 *
 * @param rows Whatever the store returned. Any shape is tolerated.
 * @param slug Only rows carrying exactly this slug are counted.
 */
export function tallyReactions(rows: unknown, slug: string): ReactionTally {
  // Keyed by the closed vocabulary rather than by anything a row carries, so
  // a row naming `__proto__` or `constructor` has no key to reach for.
  const counts = new Map<DislikeReason, number>();
  let likes = 0;
  let dislikes = 0;

  if (!Array.isArray(rows)) {
    return { likes, dislikes, dislikeReasons: Object.fromEntries(counts) };
  }

  for (const row of rows) {
    if (!isRecord(row)) continue;
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
        counts.set(reason.id, (counts.get(reason.id) ?? 0) + 1);
      }
    }
  }

  return { likes, dislikes, dislikeReasons: Object.fromEntries(counts) };
}

/** A non-negative integer under `key`, or `null` for anything else. */
function countAt(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Narrows one `reaction_counts` row into a tally, or `null` when the row is
 * not the shape that view produces.
 *
 * Reads field by field against the closed vocabulary rather than iterating the
 * row's keys, for the same reason {@link tallyReactions} does: a column the
 * store invented has nothing here to land in.
 *
 * @param row One row of the aggregate view. Any shape is tolerated.
 * @param slug Only a row carrying exactly this slug is read.
 */
export function tallyFromCountsRow(row: unknown, slug: string): ReactionTally | null {
  if (!isRecord(row)) return null;
  if (!('slug' in row) || row.slug !== slug) return null;

  const likes = countAt(row, 'likes');
  const dislikes = countAt(row, 'dislikes');
  if (likes === null || dislikes === null) return null;

  const dislikeReasons: Partial<Record<DislikeReason, number>> = {};
  for (const reason of DISLIKE_REASONS) {
    const count = countAt(row, reason.id);
    // Absent and zero read the same, matching a tally built from raw rows.
    if (count !== null && count > 0) dislikeReasons[reason.id] = count;
  }

  return { likes, dislikes, dislikeReasons };
}
