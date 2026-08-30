// Pure prompt assembly — no network, no file I/O, so it can be snapshot
// tested against fixed fixtures. Everything the model sees about past
// games, guardrails and output format is decided here.
import type {
  GenreEntry,
  GenresConfig,
  HistoryGameEntry,
  HistorySummary,
  PopularityEntry,
} from './lib/types.ts';

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

export const SYSTEM_PROMPT = `You are a game designer and front-end engineer who invents small, complete,
original browser games. You always return working, self-contained code that
runs with no build step, no dependencies, and no network access. You follow
content rules exactly and without exception.`;

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

/** A compact "don't repeat these" digest of the most recent published games. */
export function digestHistory(entries: HistoryGameEntry[], limit = 10): string {
  const recent = mostRecentFirst(entries).slice(0, limit);
  if (recent.length === 0) {
    return 'No games have been published yet — you are building the very first one.';
  }

  return recent
    .map((entry) => {
      const mechanics = entry.mechanics?.length ? entry.mechanics.join(', ') : 'unrecorded';
      return `- ${entry.date} · genre: ${entry.genre ?? 'unknown'} · theme: ${entry.theme ?? 'unknown'} · mechanics: ${mechanics}`;
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

## Recently published games — do not repeat these

${digestHistory(historyEntries, historyDigestLimit)}
${lessonsSection(summary.lessons)}${remixSection(remixSuggestion)}${failureFeedbackSection(priorFailureFeedback)}
## Output format

${OUTPUT_FORMAT_CONTRACT}`;
}
