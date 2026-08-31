// Writes a successful generation to disk: the dated archive folder, the
// manifest the front-end reads, and the history files.
//
// The error-reporting snippet appended to game.html comes from
// lib/errorReporting.ts — ours, never the model's. It is empty until
// config/generation.json carries a Sentry DSN.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPaths, paths as defaultPaths, type Paths } from './lib/paths.ts';
import { appendEntry, writeGamesJson, writeGamesMd } from './lib/history-store.ts';
import { buildErrorReportingSnippet } from './lib/errorReporting.ts';
import type { GeneratedMeta } from '../lib/extract-bundle-shared.ts';
import type { Manifest } from '../lib/manifest.ts';
import type { FailureKind, HistoryGameEntry } from './lib/history-store.ts';
import type { GenerationConfig } from './lib/config/generation.ts';
import type { GenresConfig } from './lib/config/genres.ts';

const MS_PER_DAY = 86_400_000;

/**
 * Cap on a stored failure reason. Smoke-test reasons carry the game's own
 * console output, which a misbehaving bundle can produce without limit, and
 * these strings reach the rollup prompt.
 */
const MAX_FAILURE_REASON_LENGTH = 300;

/**
 * Slugs become directory names and URL segments. Capped so that the full
 * `YYYY-MM-DD-<slug>` path stays comfortably short for any filesystem or
 * server; a truncation can leave a trailing dash, so trim again after.
 */
const MAX_SLUG_LENGTH = 60;

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}

export function buildSlug(date: string, title: string): string {
  return `${date}-${slugify(title)}`;
}

/**
 * Next occurrence of a daily cron expression, strictly after `from`.
 *
 * Only the daily `M H * * *` shape is supported — the shape this project
 * actually uses — and anything else falls back to 24 hours later, so an
 * exotic schedule degrades to a sane countdown instead of throwing.
 */
export function computeExpiresAt(cronSchedule: string, fromISO: string): string {
  const from = new Date(fromISO);
  if (Number.isNaN(from.getTime())) {
    throw new Error(`computeExpiresAt: invalid date ${fromISO}`);
  }

  const parts = cronSchedule.trim().split(/\s+/);
  const [minuteField, hourField, dayField, monthField, weekdayField] = parts;
  const isPlainDaily =
    parts.length === 5 && dayField === '*' && monthField === '*' && weekdayField === '*';

  const minute = Number(minuteField);
  const hour = Number(hourField);
  if (!isPlainDaily || !Number.isInteger(minute) || !Number.isInteger(hour)) {
    return new Date(from.getTime() + MS_PER_DAY).toISOString();
  }

  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute, 0, 0),
  );
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

export type { Manifest };

export interface BuildManifestParams {
  date: string;
  slug: string;
  meta: GeneratedMeta;
  model: string;
  generatedAt: string;
  cronSchedule: string;
  /** Genre catalogue, used to resolve {@link Manifest.genreLabel}. */
  genres: GenresConfig;
  paths?: Paths;
}

export function buildManifest({
  date,
  slug,
  meta,
  model,
  generatedAt,
  cronSchedule,
  genres,
  paths = defaultPaths,
}: BuildManifestParams): Manifest {
  return {
    date,
    slug,
    path: paths.archiveGameUrlPath(slug),
    promptPath: paths.archiveGamePromptUrlPath(slug),
    title: meta.title,
    genre: meta.genre,
    // An unknown id means the model ignored the catalogue; show what it
    // said rather than an empty chip.
    genreLabel: genres.find((genre) => genre.id === meta.genre)?.label ?? meta.genre,
    model,
    generatedAt,
    expiresAt: computeExpiresAt(cronSchedule, generatedAt),
    controls: meta.controls,
  };
}

export interface PublishParams {
  date: string;
  meta: GeneratedMeta;
  html: string;
  model: string;
  attempts: number;
  /** Whether the game painted anything during the smoke test. */
  canvasDrawn?: boolean;
  /** The exact user-turn prompt that produced `html` — see BYOK. */
  prompt: string;
  generationConfig: GenerationConfig;
  /** Genre catalogue, used to resolve {@link Manifest.genreLabel}. */
  genres: GenresConfig;
  historyEntries: HistoryGameEntry[];
  generatedAt?: string;
  /** Repo root to write into — overridden in tests. */
  root?: string;
}

export interface PublishResult {
  slug: string;
  manifest: Manifest;
  historyEntries: HistoryGameEntry[];
}

export function publish({
  date,
  meta,
  html,
  model,
  attempts,
  canvasDrawn,
  prompt,
  generationConfig,
  genres,
  historyEntries,
  generatedAt = new Date().toISOString(),
  root,
}: PublishParams): PublishResult {
  const paths = root ? createPaths(root) : defaultPaths;
  const slug = buildSlug(date, meta.title);

  const gameDir = paths.archiveGameDir(slug);
  mkdirSync(gameDir, { recursive: true });

  const snippet = buildErrorReportingSnippet(generationConfig.sentryDsn, slug);
  writeFileSync(join(gameDir, 'game.html'), `${html}${snippet}`, 'utf8');
  writeFileSync(join(gameDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  writeFileSync(join(gameDir, 'prompt.txt'), prompt, 'utf8');

  const manifest = buildManifest({
    date,
    slug,
    meta,
    model,
    generatedAt,
    cronSchedule: generationConfig.cronSchedule,
    genres,
    paths,
  });
  writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const entry: HistoryGameEntry = {
    date,
    status: 'published',
    model,
    slug,
    genre: meta.genre,
    theme: meta.theme,
    mechanics: meta.mechanics,
    title: meta.title,
    attempts,
    ...(canvasDrawn === undefined ? {} : { canvasDrawn }),
  };
  const updatedEntries = appendEntry(historyEntries, entry);
  writeGamesJson(paths.historyGames, updatedEntries);
  writeGamesMd(paths.historyGamesMd, updatedEntries);

  return { slug, manifest, historyEntries: updatedEntries };
}

/**
 * Records a failed run without touching the live site.
 *
 * @param reasons Why each attempt failed. Required rather than optional so
 *   a caller cannot quietly drop the only record of what went wrong; pass
 *   an empty array if there is genuinely nothing to say.
 */
export function recordFailure({
  date,
  model,
  attempts,
  reasons,
  kinds,
  historyEntries,
  root,
}: {
  date: string;
  model: string;
  attempts: number;
  reasons: readonly string[];
  kinds: readonly FailureKind[];
  historyEntries: HistoryGameEntry[];
  root?: string;
}): HistoryGameEntry[] {
  const paths = root ? createPaths(root) : defaultPaths;
  const updatedEntries = appendEntry(historyEntries, {
    date,
    status: 'failed_kept_previous',
    model,
    attempts,
    failureReasons: reasons.map((reason) => reason.slice(0, MAX_FAILURE_REASON_LENGTH)),
    failureKinds: [...kinds],
  });
  writeGamesJson(paths.historyGames, updatedEntries);
  writeGamesMd(paths.historyGamesMd, updatedEntries);
  return updatedEntries;
}
