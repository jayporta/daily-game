// The genre catalog section of the prompt: one line per genre, with the
// recently used ones flagged.

import type { GenreEntry, GenresConfig } from '#actions_pipeline/lib/config/genres.ts';

function formatGenreLine(genre: GenreEntry, isRecentlyUsed: boolean): string {
  const examples = genre.examples.join('; ');
  const marker = isRecentlyUsed ? ' [RECENTLY USED — avoid]' : '';
  return `- ${genre.id} (${genre.label})${marker}: ${examples}`;
}

/**
 * Renders the genre catalog as one line per genre, flagging the ones to avoid.
 *
 * @param genres - The parsed `config/genres.json`, in file order.
 * @param recentGenreIds - Ids to mark as recently used, typically from
 * {@link recentlyUsedGenreIds}. Ids not present in `genres` are ignored.
 *
 * @returns Newline-separated lines, each naming a genre's id, label and examples.
 */
export function formatGenreCatalog(genres: GenresConfig, recentGenreIds: string[] = []): string {
  const recent = new Set(recentGenreIds);
  return genres.map((genre) => formatGenreLine(genre, recent.has(genre.id))).join('\n');
}
