// The vocabulary shared by the browser and the daily pipeline: what a
// visitor can say about a game, and what a slug is allowed to look like.
//
// Lives in lib/ (not src/lib/ or scripts/lib/) because both sides need it —
// the browser to render the choices, the pipeline to validate what comes
// back from the store — and lib/ is compiled by both tsconfigs, so a
// Node-only API here fails the web build.

/**
 * The closed set of reasons a visitor may give for disliking a game.
 *
 * Closed by design: the ids are the only thing that crosses the network, so
 * nothing a visitor invents can reach `history/games.json` or, later, the
 * generation prompt. That is what makes freetext feedback unnecessary here,
 * and with it a whole prompt-injection path.
 *
 * The UI's "All of the above" is a select-all convenience, not a member —
 * choosing it stores these five ids.
 */
export const DISLIKE_REASONS = [
  { id: 'broken', label: "Doesn't work" },
  { id: 'missing-art', label: 'Works but missing background or sprites' },
  { id: 'goal-unclear', label: 'Goal unclear' },
  { id: 'controls-unclear', label: "Controls don't work as displayed" },
  { id: 'gametype-mismatch', label: "Game type doesn't match output" },
] as const satisfies readonly { readonly id: string; readonly label: string }[];

/** One of {@link DISLIKE_REASONS}' ids. */
export type DislikeReason = (typeof DISLIKE_REASONS)[number]['id'];

/** Every way a visitor can react. The single source for the union below. */
export const REACTION_KINDS = ['like', 'dislike'] as const;

/** Which way a visitor reacted. */
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** The row the browser inserts, and the pipeline reads back. */
export interface ReactionPayload {
  readonly slug: string;
  readonly reaction: ReactionKind;
  /** Always empty for a like; possibly empty for a dislike. */
  readonly reasons: readonly DislikeReason[];
}

const REASON_IDS: ReadonlySet<string> = new Set(DISLIKE_REASONS.map((reason) => reason.id));

/**
 * Narrows an untrusted value to a known reason id.
 *
 * Backed by a `Set`, so inherited object keys like `__proto__` and
 * `constructor` are rejected along with everything else outside the
 * vocabulary — an `in` or property lookup would not be.
 */
export function isDislikeReason(value: unknown): value is DislikeReason {
  return typeof value === 'string' && REASON_IDS.has(value);
}

/**
 * Slugs as `publish.ts` builds them: an ISO date followed by a kebab-case
 * title. Anchored, and with no `.` or `/`, so a slug can never traverse a
 * URL path or a directory.
 *
 * Exported because the reaction store constrains its `slug` column with
 * this same pattern — see `scripts/reaction-store-schema.ts`, which reads
 * it from here rather than repeating it.
 */
export const SLUG_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;

/**
 * Whether a value is a slug this project could have published.
 *
 * Slugs derive from AI-generated titles, and come back from a store any
 * visitor can write to, so both directions validate rather than trust.
 */
export function isPublishableSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value);
}
