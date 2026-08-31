// Writes a successful generation to disk: the dated archive folder, the
// manifest the front-end reads, and the history files. Also the only other
// writer of manifest.json — `restoreManifestFromArchive` repoints it at the
// newest surviving archive when it has stopped naming a game at all.
//
// Two things are added to game.html here, both ours and never the model's:
// a `connect-src` policy in its <head>, and the error-reporting snippet at
// the end. Both come from lib/errorReporting.ts and both are keyed off
// config/generation.json's sentryDsn. This is the only point at which a
// bundle is touched — nothing downstream may transform it again.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPaths, paths as defaultPaths, type Paths } from './lib/paths.ts';
import { appendEntry, writeGamesJson, writeGamesMd } from './lib/history-store.ts';
import { buildBundleCspMeta, buildErrorReportingSnippet } from './lib/errorReporting.ts';
import { toGeneratedMeta } from '../lib/extract-bundle-shared.ts';
import { isManifest } from '../lib/manifest.ts';
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

/**
 * Puts `meta` at the start of the document's `<head>`.
 *
 * A meta CSP is ignored outside `<head>`, so it cannot simply be prepended —
 * and prepending before the doctype would drop the page into quirks mode.
 * Falls back to just after `<html>`, where the parser hoists it into an
 * implied head.
 *
 * @returns The document unchanged when it carries neither tag. The sandbox,
 *   not this policy, is the control, and a bundle that has already cleared
 *   moderation and the smoke test must not be lost to a missing tag.
 */
export function withHeadMeta(html: string, meta: string): string {
  const inHead = html.replace(/<head\b[^>]*>/i, (tag) => `${tag}\n${meta}`);
  if (inHead !== html) return inHead;
  return html.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n${meta}`);
}

export interface BuildManifestParams {
  date: string;
  slug: string;
  meta: GeneratedMeta;
  model: string;
  generatedAt: string;
  cronSchedule: string;
  /** Genre catalogue, used to resolve {@link Manifest.genreLabel}. */
  genres: GenresConfig;
  /**
   * Whether the archive holds the prompt that produced this game. A game
   * archived before prompts were has none, and its manifest must omit
   * {@link Manifest.promptPath} rather than name a file that 404s.
   */
  hasArchivedPrompt?: boolean;
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
  hasArchivedPrompt = true,
  paths = defaultPaths,
}: BuildManifestParams): Manifest {
  return {
    date,
    slug,
    path: paths.archiveGameUrlPath(slug),
    ...(hasArchivedPrompt ? { promptPath: paths.archiveGamePromptUrlPath(slug) } : {}),
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

  const hardened = withHeadMeta(html, buildBundleCspMeta(generationConfig.sentryDsn));
  const snippet = buildErrorReportingSnippet(generationConfig.sentryDsn, slug);
  writeFileSync(join(gameDir, 'game.html'), `${hardened}${snippet}`, 'utf8');
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

/**
 * What {@link restoreManifestFromArchive} found.
 *
 * `intact` means the manifest was already naming a bundle that is on disk
 * and nothing was written — the overwhelmingly common case, and the one
 * that keeps a failed run from touching a live site.
 */
export type ManifestRestoreResult =
  | { status: 'intact' }
  | { status: 'restored'; manifest: Manifest }
  | { status: 'no-candidate' };

export interface RestoreManifestParams {
  /** The hot window, oldest first, as {@link readHotWindow} returns it. */
  historyEntries: readonly HistoryGameEntry[];
  generationConfig: GenerationConfig;
  /** Genre catalogue, used to resolve {@link Manifest.genreLabel}. */
  genres: GenresConfig;
  /** Repo root to write into — overridden in tests. */
  root?: string;
}

/**
 * Whether `manifest.json` currently names a bundle the site can actually
 * serve — the one question that decides whether the manifest is left alone.
 *
 * The bundle has to sit inside the archive, not merely exist — see
 * {@link Paths.isArchivedFile}, which `assemble-site.ts` asks the same
 * question of before a deploy.
 */
function manifestServesAGame(paths: Paths): boolean {
  if (!existsSync(paths.manifest)) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(paths.manifest, 'utf8'));
  } catch {
    return false;
  }
  if (!isManifest(parsed)) return false;
  return paths.isArchivedFile(parsed.path) && existsSync(join(paths.root, parsed.path));
}

/**
 * The archived metadata for `slug`, if that day is still playable.
 *
 * @returns `null` when the directory, the bundle or a readable `meta.json`
 *   is missing, or when the metadata names no title — a manifest built from
 *   any of those would point the front-end at nothing, or at a blank card.
 */
function readArchivedMeta(paths: Paths, slug: string): GeneratedMeta | null {
  const gameDir = paths.archiveGameDir(slug);
  if (!existsSync(join(gameDir, 'game.html'))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(gameDir, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }

  const meta = toGeneratedMeta(parsed);
  return meta.title.length > 0 ? meta : null;
}

/**
 * Repoints `manifest.json` at the newest archived game that is still on disk.
 *
 * A run that fails every attempt keeps the previous manifest, which is right
 * while that manifest is serving a game. When it is the seed-state `null`,
 * unparseable, or naming a bundle that is gone, "keeping" it leaves the site
 * with nothing to show even though the archive still holds a playable game.
 *
 * Only ever fires in that case: a manifest whose bundle exists is returned as
 * `intact` and never rewritten, so this cannot replace a live game with an
 * older one.
 *
 * The restored `generatedAt` is the archived day's midnight UTC — the entry
 * records a date, not a time — so `expiresAt` lands on that day's run and the
 * countdown reads as already elapsed, exactly as a kept manifest does.
 *
 * @param historyEntries Searched newest-first for a `published` day.
 * @returns What it found; a `restored` result has already been written.
 */
export function restoreManifestFromArchive({
  historyEntries,
  generationConfig,
  genres,
  root,
}: RestoreManifestParams): ManifestRestoreResult {
  const paths = root ? createPaths(root) : defaultPaths;
  if (manifestServesAGame(paths)) return { status: 'intact' };

  for (let index = historyEntries.length - 1; index >= 0; index -= 1) {
    const entry = historyEntries[index];
    if (entry === undefined || entry.status !== 'published') continue;

    const slug = entry.slug;
    if (slug === undefined) continue;

    const meta = readArchivedMeta(paths, slug);
    if (meta === null) continue;

    const manifest = buildManifest({
      date: entry.date,
      slug,
      meta,
      model: entry.model,
      generatedAt: `${entry.date}T00:00:00.000Z`,
      cronSchedule: generationConfig.cronSchedule,
      genres,
      hasArchivedPrompt: existsSync(join(paths.archiveGameDir(slug), 'prompt.txt')),
      paths,
    });
    writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { status: 'restored', manifest };
  }

  return { status: 'no-candidate' };
}
