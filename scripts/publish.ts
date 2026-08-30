// Writes a successful generation to disk: the dated archive folder, the
// manifest the front-end reads, and the history files.
//
// The error-reporting snippet appended to game.html is written HERE, not
// by the model, so a bad generation can never omit or subvert it. Until
// Epic 6 provisions a Sentry DSN it is deliberately empty.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPaths, paths as defaultPaths, type Paths } from './lib/paths.ts';
import { appendEntry, writeGamesJson, writeGamesMd } from './lib/history-store.ts';
import type { GeneratedMeta, Manifest } from '../lib/types.ts';
import type { GenerationConfig, HistoryGameEntry } from './lib/types.ts';

const MS_PER_DAY = 86_400_000;

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
  paths?: Paths;
}

export function buildManifest({
  date,
  slug,
  meta,
  model,
  generatedAt,
  cronSchedule,
  paths = defaultPaths,
}: BuildManifestParams): Manifest {
  return {
    date,
    slug,
    path: paths.archiveGameUrlPath(slug),
    title: meta.title,
    genre: meta.genre,
    model,
    generatedAt,
    expiresAt: computeExpiresAt(cronSchedule, generatedAt),
  };
}

/**
 * Fixed, trusted snippet appended to every published game.
 * Returns '' while `sentryDsn` is null, which is the case until a Sentry
 * account exists.
 */
export function buildErrorReportingSnippet(sentryDsn: string | null, slug: string): string {
  if (!sentryDsn) return '';
  return `
<!-- Error reporting appended by publish.ts — not model-authored. -->
<script>
window.addEventListener('error', function (event) {
  try {
    navigator.sendBeacon(${JSON.stringify(sentryDsn)}, JSON.stringify({
      slug: ${JSON.stringify(slug)},
      message: String(event.message),
      source: String(event.filename),
      line: event.lineno
    }));
  } catch (e) {}
});
</script>
`;
}

export interface PublishParams {
  date: string;
  meta: GeneratedMeta;
  html: string;
  model: string;
  attempts: number;
  generationConfig: GenerationConfig;
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
  generationConfig,
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

  const manifest = buildManifest({
    date,
    slug,
    meta,
    model,
    generatedAt,
    cronSchedule: generationConfig.cronSchedule,
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
  };
  const updatedEntries = appendEntry(historyEntries, entry);
  writeGamesJson(paths.historyGames, updatedEntries);
  writeGamesMd(paths.historyGamesMd, updatedEntries);

  return { slug, manifest, historyEntries: updatedEntries };
}

/** Records a failed run without touching the live site. */
export function recordFailure({
  date,
  model,
  attempts,
  historyEntries,
  root,
}: {
  date: string;
  model: string;
  attempts: number;
  historyEntries: HistoryGameEntry[];
  root?: string;
}): HistoryGameEntry[] {
  const paths = root ? createPaths(root) : defaultPaths;
  const updatedEntries = appendEntry(historyEntries, {
    date,
    status: 'failed_kept_previous',
    model,
    attempts,
  });
  writeGamesJson(paths.historyGames, updatedEntries);
  writeGamesMd(paths.historyGamesMd, updatedEntries);
  return updatedEntries;
}
