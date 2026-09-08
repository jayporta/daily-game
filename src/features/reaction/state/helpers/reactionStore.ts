// Where this build sends reactions: the one place the shipped config is read.
// Isolated from `reaction.ts` so that module stays free of a JSON import the
// Node test runner cannot resolve.
//
// Imported at build time rather than fetched: `deploy-pages.yml` rebuilds
// the site on every push to `main`, so an edit to the JSON always ships,
// and the page avoids a second network round-trip plus a set of failure
// states for a file that changes almost never.
import raw from '#config/reaction-config.json';
import { isReactionConfig, type ReactionConfig } from '#lib/reaction-types.ts';

/** No store configured — the safe state, making no requests at all. */
const UNCONFIGURED: ReactionConfig = { endpointUrl: null, anonKey: null };

/**
 * The reaction store this build writes to.
 *
 * A malformed hand-edit degrades to {@link UNCONFIGURED} rather than
 * throwing: a broken reaction config must never take the game down with
 * it. `npm run typecheck` catches the mistake at build time instead.
 */
export const reactionConfig: ReactionConfig = isReactionConfig(raw) ? raw : UNCONFIGURED;
