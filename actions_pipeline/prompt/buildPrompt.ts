// Assembles the generation prompt from its sections. Pure — no network, no
// file I/O — so it can be tested against fixed fixtures.

import type { GenresConfig } from '#actions_pipeline/lib/config/genres.ts';
import type {
  HistoryGameEntry,
  HistorySummary,
  PopularityEntry,
} from '#actions_pipeline/lib/historyStore.ts';
import {
  correctiveDirectives,
  directivesSection,
} from '#actions_pipeline/prompt/correctiveDirectives.ts';
import { DISPLAY_CONTRACT } from '#actions_pipeline/prompt/displayContract.ts';
import { formatGenreCatalog } from '#actions_pipeline/prompt/genreCatalog.ts';
import { digestHistory, recentlyUsedGenreIds } from '#actions_pipeline/prompt/historyDigest.ts';
import { OUTPUT_FORMAT_CONTRACT } from '#actions_pipeline/prompt/outputContract.ts';
import { remixSection } from '#actions_pipeline/prompt/remix.ts';
import { renderAttemptFeedback } from '#lib/attemptFeedback.ts';

function lessonsSection(lessons: string): string {
  const trimmed = lessons.trim();
  if (trimmed.length === 0) return '';
  return `
## Lessons from past builds

${trimmed}
`;
}

/** Everything {@link buildPrompt} assembles a generation prompt from. */
export interface BuildPromptParams {
  /** The content rules, verbatim from `config/`. */
  guardrailsText: string;
  /** The parsed `config/genres.json`, offered as a catalog to choose from. */
  genres: GenresConfig;
  /** History entries, used for the recent-days digest and the corrective directives. */
  historyEntries: HistoryGameEntry[];
  /** The rolled-up history summary. Only its `lessons` note reaches the prompt. */
  summary: HistorySummary;
  /** A past game to suggest a successor to, from {@link selectRemixSuggestion}. Omitted most days. */
  remixSuggestion?: PopularityEntry | null;
  /**
   * What went wrong on the attempt just before this one. Absent on a first
   * attempt; otherwise rendered as its own section by
   * {@link renderAttemptFeedback}.
   *
   * @remarks
   * This section survives into the archived `prompt.txt`, which is the exact
   * prompt that produced that day's game. BYOK is what removes it, at replay
   * time, so a visitor's fresh generation is not told to fix a failure that
   * never happened to it — see `stripAttemptFeedback` in
   * `lib/attemptFeedback.ts`.
   */
  priorFailureFeedback?: string;
  /**
   * How many recent published entries the digest, the corrective directives
   * and the recently-used genre marks each look back over.
   *
   * @defaultValue `10`
   */
  historyDigestLimit?: number;
}

/**
 * Assembles the full generation prompt for one attempt.
 *
 * @remarks
 * Model-authored history is shown as labelled data, never as guidance, and
 * the closed `DISLIKE_REASONS` and `FAILURE_KINDS` vocabularies key the
 * fixed wording of the corrective directives, so no text a visitor or a
 * previous generation wrote is quoted into the instructions.
 *
 * `summary.lessons` is the one exception, and a deliberate one: a model
 * writes that note during reflection from history that embeds
 * `failureReasons`, and it lands here as guidance. It is the single path by
 * which model-authored text steers a later generation. Both hops are
 * length-capped; keep them.
 *
 * @param params - See {@link BuildPromptParams}.
 *
 * @returns The complete prompt, ending with the output-format contract that
 * `lib/extractBundleShared.ts` parses. The two must change together.
 */
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
${directivesSection(correctiveDirectives(historyEntries, historyDigestLimit))}${lessonsSection(summary.lessons)}${remixSection(remixSuggestion)}${renderAttemptFeedback(priorFailureFeedback)}
## How your game is displayed

${DISPLAY_CONTRACT}

## Output format

${OUTPUT_FORMAT_CONTRACT}`;
}
