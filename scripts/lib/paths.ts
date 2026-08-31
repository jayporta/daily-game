// Single source of truth for repo-relative paths, so no other module
// hardcodes a directory layout that might change. Built as a factory so
// tests can point the whole pipeline at a scratch directory.
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface Paths {
  root: string;
  modelsConfig: string;
  byokModelsConfig: string;
  genresConfig: string;
  generationConfig: string;
  reactionConfig: string;
  guardrails: string;
  /** The page shell, whose CSP has to permit the reaction store's origin. */
  indexHtml: string;
  historyGames: string;
  historySummary: string;
  historyGamesMd: string;
  historyArchiveDir: string;
  /** Cold storage for one month of aged-out entries, as JSONL. */
  historyArchiveFile(month: string): string;
  manifest: string;
  archiveDir: string;
  archiveGameDir(slug: string): string;
  /** Path recorded inside manifest.json — always POSIX-style, URL-facing. */
  archiveGameUrlPath(slug: string): string;
  /** Where the exact prompt that produced this game is published — see BYOK. */
  archiveGamePromptUrlPath(slug: string): string;
  /**
   * Whether a manifest's repo-relative path names a file inside the archive.
   *
   * Assembly copies only `games/archive/` into `dist/`, so a path leading
   * anywhere else names a file no visitor can reach, however real it is in
   * the repo. Resolved and compared as a relative path rather than matched as
   * a string prefix, because `..` segments normalise away when a path is
   * resolved — `games/archive/../../elsewhere` starts with the archive and
   * does not live in it.
   *
   * @param urlPath A POSIX-style path as a manifest records it, e.g.
   *   `games/archive/2026-08-30-thing/game.html`.
   */
  isArchivedFile(urlPath: string): boolean;
}

export function createPaths(root: string = REPO_ROOT): Paths {
  return {
    root,
    modelsConfig: join(root, 'config', 'models.json'),
    byokModelsConfig: join(root, 'config', 'byok-models.json'),
    genresConfig: join(root, 'config', 'genres.json'),
    generationConfig: join(root, 'config', 'generation.json'),
    reactionConfig: join(root, 'config', 'reaction-config.json'),
    guardrails: join(root, 'config', 'guardrails.md'),
    indexHtml: join(root, 'index.html'),
    historyGames: join(root, 'history', 'games.json'),
    historySummary: join(root, 'history', 'summary.json'),
    historyGamesMd: join(root, 'history', 'games.md'),
    historyArchiveDir: join(root, 'history', 'archive'),
    historyArchiveFile: (month: string) => join(root, 'history', 'archive', `${month}.jsonl`),
    manifest: join(root, 'manifest.json'),
    archiveDir: join(root, 'games', 'archive'),
    archiveGameDir: (slug: string) => join(root, 'games', 'archive', slug),
    archiveGameUrlPath: (slug: string) => `games/archive/${slug}/game.html`,
    archiveGamePromptUrlPath: (slug: string) => `games/archive/${slug}/prompt.txt`,
    isArchivedFile: (urlPath: string) => {
      const within = relative(join(root, 'games', 'archive'), resolve(root, urlPath));
      return within.length > 0 && !within.startsWith('..') && !isAbsolute(within);
    },
  };
}

/** The real repo's paths — what the pipeline uses outside of tests. */
export const paths = createPaths();
