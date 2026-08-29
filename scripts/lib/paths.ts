// Single source of truth for repo-relative paths, so no other module
// hardcodes a directory layout that might change. Built as a factory so
// tests can point the whole pipeline at a scratch directory.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface Paths {
  root: string;
  modelsConfig: string;
  genresConfig: string;
  generationConfig: string;
  guardrails: string;
  historyGames: string;
  historySummary: string;
  historyGamesMd: string;
  historyArchiveDir: string;
  manifest: string;
  archiveDir: string;
  archiveGameDir(slug: string): string;
  /** Path recorded inside manifest.json — always POSIX-style, URL-facing. */
  archiveGameUrlPath(slug: string): string;
}

export function createPaths(root: string = REPO_ROOT): Paths {
  return {
    root,
    modelsConfig: join(root, 'config', 'models.json'),
    genresConfig: join(root, 'config', 'genres.json'),
    generationConfig: join(root, 'config', 'generation.json'),
    guardrails: join(root, 'config', 'guardrails.md'),
    historyGames: join(root, 'history', 'games.json'),
    historySummary: join(root, 'history', 'summary.json'),
    historyGamesMd: join(root, 'history', 'games.md'),
    historyArchiveDir: join(root, 'history', 'archive'),
    manifest: join(root, 'manifest.json'),
    archiveDir: join(root, 'games', 'archive'),
    archiveGameDir: (slug: string) => join(root, 'games', 'archive', slug),
    archiveGameUrlPath: (slug: string) => `games/archive/${slug}/game.html`,
  };
}

/** The real repo's paths — what the pipeline uses outside of tests. */
export const paths = createPaths();
