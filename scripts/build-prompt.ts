// Pure prompt assembly — no network, no file I/O, so it can be snapshot
// tested against fixed fixtures. Everything the model sees about past
// games, guardrails and output format is decided here.
import { isDislikeReason, type DislikeReason } from '../lib/reaction-types.ts';
import type { FailureKind, HistoryGameEntry, HistorySummary, PopularityEntry } from './lib/history-store.ts';
import type { GenreEntry, GenresConfig } from './lib/config/genres.ts';

/**
 * The two-fenced-block contract. This is the parsing contract enforced by
 * lib/extract-bundle-shared.ts — if you change the fence languages here,
 * change the extractor's regexes to match, or every generation will fail.
 */
export const OUTPUT_FORMAT_CONTRACT = `Return EXACTLY two fenced code blocks and nothing else that could be mistaken for them.

First, a block tagged \`json\` containing only this object:
\`\`\`json
{"title": "...", "genre": "...", "theme": "...", "mechanics": ["...", "..."], "controls": [{"action": "...", "key": "..."}]}
\`\`\`

Second, a block tagged \`html\` containing the entire game as ONE self-contained HTML file:
\`\`\`html
<!doctype html>
...your complete game, with inline <style> and <script> only...
\`\`\`

The \`genre\` value must be one of the genre ids listed above. The html block
must be a complete, immediately playable document that needs no other files.

The \`controls\` array must list the inputs your game actually listens for,
using whatever control scheme you chose — \`action\` describes what it does in
your game, \`key\` is what the player presses, clicks or drags. List only
inputs the code really handles, and return an empty array if the game needs
none.`;

/**
 * How the finished game is presented, which the model has no other way to
 * know. Without it a game is free to draw itself at a fixed size on its own
 * background, and the rest of the frame is left blank around it.
 *
 * Deliberately NOT in `config/guardrails.md`. That file is injected verbatim
 * into the moderation prompt too, and the moderator fails closed — a layout
 * rule there would have it rejecting games over how they look rather than
 * what they contain.
 *
 * Names no size. A model handed a number copies it, and a fixed canvas is
 * the exact failure this exists to prevent.
 */
export const DISPLAY_CONTRACT = `Your document is loaded on its own into a frame that fills the middle of the
page. Nothing outside your document paints any part of that frame, so
whatever you leave unfilled shows as blank space around your game.

- Fill the frame. Give \`html\` and \`body\` no margin and the full width and
  height available, and paint your own background across all of it.
- Size to the frame at runtime, never to a constant. If you draw on a
  canvas, set its width and height from its measured container rather than
  with fixed attributes, and redraw when the frame is resized.
- Assume nothing about its shape. It is as wide and as tall as the visitor's
  window makes it, in any proportion, on a phone or on a desktop.
- Keep the whole playfield inside it. Never require the player to scroll.`;

function formatGenreLine(genre: GenreEntry, isRecentlyUsed: boolean): string {
  const examples = genre.examples.join('; ');
  const marker = isRecentlyUsed ? ' [RECENTLY USED — avoid]' : '';
  return `- ${genre.id} (${genre.label})${marker}: ${examples}`;
}

export function formatGenreCatalog(genres: GenresConfig, recentGenreIds: string[] = []): string {
  const recent = new Set(recentGenreIds);
  return genres.map((genre) => formatGenreLine(genre, recent.has(genre.id))).join('\n');
}

function publishedEntries(entries: HistoryGameEntry[]): HistoryGameEntry[] {
  return entries.filter((entry) => entry.status === 'published');
}

/** Most recent published entries first. */
function mostRecentFirst(entries: HistoryGameEntry[]): HistoryGameEntry[] {
  return [...publishedEntries(entries)].sort((a, b) => b.date.localeCompare(a.date));
}

export function recentlyUsedGenreIds(entries: HistoryGameEntry[], limit = 10): string[] {
  const ids = mostRecentFirst(entries)
    .slice(0, limit)
    .map((entry) => entry.genre)
    .filter((genre): genre is string => typeof genre === 'string' && genre.length > 0);
  return [...new Set(ids)];
}

/** How a published game was received, or '' when nothing is recorded yet. */
function reception(entry: HistoryGameEntry): string {
  const parts: string[] = [];
  if (entry.likes !== undefined || entry.dislikes !== undefined) {
    parts.push(`${entry.likes ?? 0} liked, ${entry.dislikes ?? 0} disliked`);
  }
  const complaints = Object.entries(entry.dislikeReasons ?? {})
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id);
  if (complaints.length > 0) parts.push(`marked: ${complaints.join(', ')}`);
  if (entry.attempts !== undefined && entry.attempts > 1) {
    parts.push(`took ${entry.attempts} attempts`);
  }
  if (entry.canvasDrawn === false) parts.push('drew nothing on screen');
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

/**
 * The recent record, with how each day actually went.
 *
 * Includes failed days as well as published ones: three broken runs in a row
 * is the most useful thing the next attempt could know, and filtering them
 * out meant the prompt never mentioned them.
 */
export function digestHistory(entries: HistoryGameEntry[], limit = 10): string {
  const recent = [...entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  if (recent.length === 0) {
    return 'No games have been published yet — you are building the very first one.';
  }

  return recent
    .map((entry) => {
      if (entry.status !== 'published') {
        const kinds = entry.failureKinds?.join(', ') || 'unrecorded';
        return `- ${entry.date} · FAILED after ${entry.attempts ?? '?'} attempts · ${kinds}`;
      }
      const mechanics = entry.mechanics?.length ? entry.mechanics.join(', ') : 'unrecorded';
      return `- ${entry.date} · genre: ${entry.genre ?? 'unknown'} · theme: ${entry.theme ?? 'unknown'} · mechanics: ${mechanics}${reception(entry)}`;
    })
    .join('\n');
}

function slugDate(slug: string): string {
  return slug.slice(0, 10);
}

function daysBetween(fromISODate: string, to: Date): number {
  const from = Date.parse(`${fromISODate}T00:00:00Z`);
  if (Number.isNaN(from)) return Number.POSITIVE_INFINITY;
  return (to.getTime() - from) / 86_400_000;
}

export interface RemixOptions {
  remixProbability: number;
  remixLookbackDays: number;
  rng?: () => number;
  now?: Date;
}

/**
 * Occasionally suggests a "spiritual successor" to a popular past game.
 * Returns null most of the time — a remix is the exception, not the rule.
 */
export function selectRemixSuggestion(
  summary: HistorySummary,
  { remixProbability, remixLookbackDays, rng = Math.random, now = new Date() }: RemixOptions,
): PopularityEntry | null {
  if (rng() >= remixProbability) return null;

  const candidates = summary.popularityLeaderboard
    .filter((entry) => daysBetween(slugDate(entry.slug), now) <= remixLookbackDays)
    .sort((a, b) => b.popularityScore - a.popularityScore);

  return candidates[0] ?? null;
}

function remixSection(remix: PopularityEntry | null): string {
  if (!remix) return '';
  return `
## Optional: spiritual successor

One past game was unusually popular:
- theme: ${remix.theme}
- mechanics: ${remix.mechanicsSummary}

You MAY build a spiritual successor to it — something that captures why it
worked. If you do, it MUST differ in genre, in theme, and in at least one
core mechanic. It must never be a repeat of that game.
`;
}

function failureFeedbackSection(priorFailureFeedback?: string): string {
  if (!priorFailureFeedback) return '';
  return `
## Fix this — your previous attempt failed

${priorFailureFeedback}

Be more defensive this time. Re-read the rules above before you start.
`;
}

function lessonsSection(lessons: string): string {
  const trimmed = lessons.trim();
  if (trimmed.length === 0) return '';
  return `
## Lessons from past builds

${trimmed}
`;
}

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
  broken:
    'Recent games were reported as not working at all. Guard every element lookup, ' +
    'start the game loop only after the DOM is ready, and never assume an asset exists.',
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

/** The same, for the ways a generation attempt can fail. */
const FAILURE_DIRECTIVES: Record<FailureKind, string> = {
  'generation-call':
    'Recent attempts failed before returning anything. Return both fenced blocks and ' +
    'nothing else.',
  extract:
    'Recent attempts returned a response that could not be parsed. Return exactly two ' +
    'fenced blocks, tagged json and html, with valid JSON in the first.',
  moderation:
    'Recent attempts were rejected by the content rules. Re-read them and stay well ' +
    'clear of anything borderline.',
  'smoke-js-error':
    'Recent games threw uncaught JavaScript errors. Guard every lookup, initialise ' +
    'state before the first frame, and never index an array without checking length.',
  'smoke-network':
    'Recent games tried to load something over the network. Everything must be inline ' +
    'in the one HTML file — no fetch, no external images, fonts or scripts.',
  'smoke-load':
    'Recent games failed to load at all. Return a complete, valid HTML document.',
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
    for (const [id, count] of Object.entries(entry.dislikeReasons ?? {})) {
      // A reason given by several visitors on one day is still one game's
      // problem; count days, not votes.
      if (count > 0 && isDislikeReason(id)) complaints.push(id);
    }
    for (const kind of entry.failureKinds ?? []) failures.push(kind);
  }

  const ranked = [
    ...[...tally(complaints)].map(([id, count]) => ({ count, text: DISLIKE_DIRECTIVES[id] })),
    ...[...tally(failures)].map(([kind, count]) => ({ count, text: FAILURE_DIRECTIVES[kind] })),
  ]
    .filter((entry) => entry.count >= DIRECTIVE_THRESHOLD)
    .sort((a, b) => b.count - a.count);

  return ranked.map((entry) => entry.text);
}

function directivesSection(directives: readonly string[]): string {
  if (directives.length === 0) return '';
  return `
## Fix what has been going wrong

${directives.map((directive) => `- ${directive}`).join('\n')}
`;
}

export interface BuildPromptParams {
  guardrailsText: string;
  genres: GenresConfig;
  historyEntries: HistoryGameEntry[];
  summary: HistorySummary;
  remixSuggestion?: PopularityEntry | null;
  priorFailureFeedback?: string;
  historyDigestLimit?: number;
}

export function buildPrompt({
  guardrailsText,
  genres,
  historyEntries,
  summary,
  remixSuggestion = null,
  priorFailureFeedback,
  historyDigestLimit = 10,
}: BuildPromptParams): string {
  const recentGenres = recentlyUsedGenreIds(historyEntries, historyDigestLimit);

  return `# Build today's game

Invent a complete, original browser game. Pick its genre, theme and
mechanics yourself from the catalog below — you are not being assigned one.

## Content rules — non-negotiable

${guardrailsText}

## Genre catalog

Choose ONE genre id from this list. Genres marked as recently used should
be avoided so the site stays varied.

${formatGenreCatalog(genres, recentGenres)}

## Recent days — how each one went

Do not repeat these themes or mechanic combinations, and learn from how they
were received.

${digestHistory(historyEntries, historyDigestLimit)}
${directivesSection(correctiveDirectives(historyEntries, historyDigestLimit))}${lessonsSection(summary.lessons)}${remixSection(remixSuggestion)}${failureFeedbackSection(priorFailureFeedback)}
## How your game is displayed

${DISPLAY_CONTRACT}

## Output format

${OUTPUT_FORMAT_CONTRACT}`;
}
