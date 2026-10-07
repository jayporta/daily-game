// Fixed guidance for whatever keeps going wrong, keyed off the closed
// complaint and failure vocabularies so no authored text reaches the prompt.

import type { FailureKind, HistoryGameEntry } from '#actions_pipeline/lib/historyStore.ts';
import { type DislikeReason, isDislikeReason } from '#lib/reactionTypes.ts';

/**
 * How many times a complaint or failure must appear in the recent window
 * before it earns a directive. One bad day is noise; two is a pattern.
 */
const DIRECTIVE_THRESHOLD = 2;

/**
 * What to tell the model when a given complaint keeps recurring.
 *
 * Our words, not the model's. The keys are the closed {@link DislikeReason}
 * vocabulary, so nothing a visitor or a previous generation wrote can reach
 * the prompt through this path — only the fixed text below.
 */
const DISLIKE_DIRECTIVES: Record<DislikeReason, string> = {
  'no-load':
    'Recent games were reported as not working at all. Guard every element lookup, ' +
    'start the game loop only after the DOM is ready, and never assume an asset exists.',
  'gameplay-broken':
    'Recent games were reported as having broken gameplay. Ensure all game mechanics ' +
    'are implemented correctly and tested thoroughly.',
  'missing-art':
    'Recent games were reported as missing their background or sprites. Draw every ' +
    'visual element yourself in code — shapes, gradients, generated patterns — and ' +
    'never reference an image file.',
  'goal-unclear':
    "Recent games were marked 'Goal unclear'. State the objective on screen in the " +
    'first frame, keep it visible, and make the win or lose condition unmistakable.',
  'controls-unclear':
    "Recent games were marked 'Controls don't work as displayed'. Every control you " +
    'list in the meta block must do exactly what it says, and the game must respond ' +
    'to it immediately.',
  'gametype-mismatch':
    "Recent games were marked 'Game type doesn't match output'. Build something that " +
    'plainly belongs to the genre id you chose.',
};

/**
 * What a recurring failure tells the next generation to do differently.
 *
 * `null` where the failure was ours, not the model's: an infrastructure
 * outage gives a model nothing to correct, and inventing guidance for one
 * teaches it to fix something it never broke.
 */
const FAILURE_DIRECTIVES: Record<FailureKind, string | null> = {
  'generation-call':
    'Recent attempts failed before returning anything. Return both fenced blocks and ' +
    'nothing else.',
  extract:
    'Recent attempts returned a response that could not be parsed. Return exactly two ' +
    'fenced blocks, tagged json and html, with valid JSON in the first.',
  'unknown-genre':
    'Recent attempts named a genre that is not in the catalogue. Copy one of the genre ids ' +
    'listed above into the json block exactly, and do not invent one or leave the example in.',
  'placeholder-meta':
    'Recent attempts left the output format\'s example values ("...") in the json block ' +
    'instead of describing the game actually built. Every field — title, theme, mechanics, ' +
    'controls — must describe your real game, not the example.',
  'placeholder-script':
    'Recent attempts returned a placeholder or stub script instead of the game. Write every ' +
    'function of the game in full; never leave a comment where code belongs.',
  moderation:
    'Recent attempts were rejected by the content rules. Re-read them and stay well ' +
    'clear of anything borderline.',
  // A provider skipped a model before a fallback answered; nothing was written to fix.
  'generation-failover': null,
  // The game was generated and parsed fine; the moderator never answered.
  'moderation-unreachable': null,
  'smoke-js-error':
    'Recent games threw uncaught JavaScript errors. Guard every lookup, initialise ' +
    'state before the first frame, and never index an array without checking length.',
  'smoke-network':
    'Recent games tried to load something over the network. Everything must be inline ' +
    'in the one HTML file — no fetch, no external images, fonts or scripts.',
  'smoke-load': 'Recent games failed to load at all. Return a complete, valid HTML document.',
  'smoke-blank':
    'Recent games loaded but showed nothing. Do not return the output format example or a ' +
    'placeholder: write the real game, paint a background, and draw the opening state before ' +
    'any input.',
};

/** Counts occurrences of each key across the window. */
function tally<T extends string>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/**
 * Fixed guidance for whatever has been going wrong lately.
 *
 * Deterministic and needs no model call: a complaint or failure that recurs
 * at least {@link DIRECTIVE_THRESHOLD} times in the window selects one of the
 * fixed strings above. Ordered most-frequent first so the worst problem leads.
 *
 * @param entries The recent window, newest first or not — order is ignored.
 */
export function correctiveDirectives(entries: HistoryGameEntry[], limit = 10): string[] {
  const recent = [...entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);

  const complaints: DislikeReason[] = [];
  const failures: FailureKind[] = [];
  for (const entry of recent) {
    if (entry.status === 'published') {
      for (const [id, count] of Object.entries(entry.dislikeReasons ?? {})) {
        // A reason given by several visitors on one day is still one game's
        // problem; count days, not votes.
        if (count > 0 && isDislikeReason(id)) complaints.push(id);
      }
    } else {
      for (const kind of entry.failureKinds) failures.push(kind);
    }
  }

  const ranked = [
    ...[...tally(complaints)].map(([id, count]) => ({ count, text: DISLIKE_DIRECTIVES[id] })),
    ...[...tally(failures)].map(([kind, count]) => ({ count, text: FAILURE_DIRECTIVES[kind] })),
  ]
    .filter((entry) => entry.count >= DIRECTIVE_THRESHOLD)
    .sort((a, b) => b.count - a.count);

  return ranked.flatMap((entry) => (entry.text === null ? [] : [entry.text]));
}

/**
 * The prompt section carrying {@link correctiveDirectives}' wording.
 *
 * @returns The section, or '' when there is nothing to say.
 */
export function directivesSection(directives: readonly string[]): string {
  if (directives.length === 0) return '';
  return `
## Fix what has been going wrong

${directives.map((directive) => `- ${directive}`).join('\n')}
`;
}
