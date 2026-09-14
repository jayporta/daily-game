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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerationConfig } from '#actions_pipeline/lib/config/generation.ts';
import type { GenresConfig } from '#actions_pipeline/lib/config/genres.ts';
import { MS_PER_DAY } from '#actions_pipeline/lib/dates.ts';
import { buildBundleCspMeta, buildErrorReportingSnippet } from '#actions_pipeline/lib/errorReporting.ts';
import type { FailureKind, HistoryGameEntry } from '#actions_pipeline/lib/historyStore.ts';
import { appendEntry, writeGamesJson, writeGamesMd } from '#actions_pipeline/lib/historyStore.ts';
import { readJsonOrNull, writeJson } from '#actions_pipeline/lib/jsonFile.ts';
import { createPaths, paths as defaultPaths, type Paths } from '#actions_pipeline/lib/paths.ts';
import type { GeneratedMeta } from '#lib/extractBundleShared.ts';
import { toGeneratedMeta } from '#lib/extractBundleShared.ts';
import type { Manifest } from '#lib/manifest.ts';
import { isManifest } from '#lib/manifest.ts';
import { QUOTA_EXCEEDED, type RunStatus } from '#lib/status.ts';

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

/**
 * Reduces free text to a URL- and filesystem-safe slug.
 *
 * @remarks
 * Runs on a model-authored title, so it has to survive any input: every
 * run of non-alphanumerics collapses to a single dash, and the result is
 * truncated then re-trimmed so a cut mid-word cannot leave a trailing dash.
 *
 * @param text - The title to reduce.
 * @returns The slug, or `'untitled'` when nothing usable survives.
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}

/**
 * The directory name and URL segment one published game is served under.
 *
 * @param date - The day, as `YYYY-MM-DD`.
 * @param title - The game's title; reduced with {@link slugify}.
 * @returns The date followed by the slugified title. Two titles that
 * slugify alike produce the same value, so this is distinct only because
 * one game is published per day.
 */
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

/** Everything {@link buildManifest} needs to describe one published game. */
export interface BuildManifestParams {
  /** The day the game is for, as `YYYY-MM-DD`. */
  date: string;
  /** The slug the game is served under, from {@link buildSlug}. */
  slug: string;
  /** The generated metadata: title, genre, theme, mechanics, controls. */
  meta: GeneratedMeta;
  /** OpenRouter model id that wrote the game. */
  model: string;
  /** When generation finished, as an ISO 8601 timestamp. */
  generatedAt: string;
  /**
   * When the next game is due, as a `M H * * *` cron expression. Drives the
   * front-end countdown, and is deliberately an hour earlier than the
   * workflow's own cron.
   */
  cronSchedule: string;
  /** Genre catalogue, used to resolve {@link Manifest.genreLabel}. */
  genres: GenresConfig;
  /**
   * Whether the archive holds the prompt that produced this game. A game
   * archived before prompts were has none, and its manifest must omit
   * {@link Manifest.promptPath} rather than name a file that 404s.
   */
  hasArchivedPrompt?: boolean;
  /** Path builder to resolve URLs against — overridden in tests. */
  paths?: Paths;
}

/**
 * Builds the manifest the front-end reads to find today's game.
 *
 * @param params - See {@link BuildManifestParams}.
 * @returns The manifest. `genreLabel` falls back to the raw genre id when
 * the model named one outside the catalogue, and `promptPath` is omitted
 * entirely when no prompt was archived.
 */
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

/** Everything {@link publish} needs to put one game live. */
export interface PublishParams {
  /** The day the game is for, as `YYYY-MM-DD`. */
  date: string;
  /** The generated metadata, written alongside the bundle as `meta.json`. */
  meta: GeneratedMeta;
  /** The complete bundle, as moderation and the smoke test approved it. */
  html: string;
  /** OpenRouter model id that wrote the game. */
  model: string;
  /** Which attempt succeeded, counting from 1. Recorded in history. */
  attempts: number;
  /** Whether the game painted anything during the smoke test. */
  canvasDrawn?: boolean;
  /** The exact user-turn prompt that produced `html` — see BYOK. */
  prompt: string;
  /**
   * Failure kinds for attempts that failed before this one succeeded,
   * parallel to `attemptModels` by index. Omitted, or empty, when the first
   * attempt won.
   *
   * Recorded so `checkModels.ts`'s reliability tally can see a model that
   * fails its attempt every day but is always rescued by a later one in the
   * rotation — without this, such a day never produces a
   * `failed_kept_previous` entry, so that model would accumulate no
   * evidence at all.
   */
  kinds?: readonly FailureKind[];
  /** The model each of those attempts used, parallel to `kinds` by index. */
  attemptModels?: readonly string[];
  /** Whether any of those attempts was refused for provider capacity. */
  quotaAffected?: boolean;
  /** The parsed `config/generation.json`; supplies the cron schedule and the Sentry DSN. */
  generationConfig: GenerationConfig;
  /** Genre catalogue, used to resolve {@link Manifest.genreLabel}. */
  genres: GenresConfig;
  /** History as it stands; the new entry is appended to a copy. */
  historyEntries: HistoryGameEntry[];
  /**
   * When generation finished, as an ISO 8601 timestamp.
   *
   * @defaultValue the current time
   */
  generatedAt?: string;
  /**
   * The commit this game was published from, tagged onto any error the
   * bundle reports.
   *
   * Passed in rather than read from the environment here, so a test names it
   * and nothing about publishing depends on where it is running.
   */
  release?: string;
  /** Repo root to write into — overridden in tests. */
  root?: string;
}

/**
 * The release name for a game published outside CI.
 *
 * A local `generate:local` produces a real bundle, and an error from one
 * should not be filed under whatever commit happened to be checked out.
 */
const UNRELEASED = 'dev';

/** What one successful publish wrote. */
export interface PublishResult {
  /** The slug the game is now served under. */
  slug: string;
  /** The manifest now on disk, naming this game. */
  manifest: Manifest;
  /** History including the new `published` entry. Not the array passed in. */
  historyEntries: HistoryGameEntry[];
}

/**
 * Puts one game live: archives the bundle, repoints the manifest at it, and
 * records the day in history.
 *
 * @remarks
 * The bundle ships byte-for-byte except for two additions, both keyed off
 * `sentryDsn`: a `connect-src` meta inside `<head>`, and the error-reporting
 * snippet appended at the end. A bundle carrying neither `<head>` nor
 * `<html>` is published without the meta rather than failed — the sandbox is
 * the control, this is defence in depth.
 *
 * @param params - See {@link PublishParams}.
 * @returns The slug, the manifest written, and the updated history.
 */
export function publish({
  date,
  meta,
  html,
  model,
  attempts,
  canvasDrawn,
  prompt,
  kinds,
  attemptModels,
  quotaAffected = false,
  generationConfig,
  genres,
  historyEntries,
  generatedAt = new Date().toISOString(),
  release = UNRELEASED,
  root,
}: PublishParams): PublishResult {
  if ((attemptModels === undefined) !== (kinds === undefined)) {
    throw new Error('attemptModels and kinds must be provided together');
  }
  if (attemptModels !== undefined && kinds !== undefined && attemptModels.length !== kinds.length) {
    throw new Error(
      `attemptModels (${attemptModels.length}) must be parallel to kinds (${kinds.length})`,
    );
  }
  const paths = root ? createPaths(root) : defaultPaths;
  const slug = buildSlug(date, meta.title);

  const gameDir = paths.archiveGameDir(slug);
  mkdirSync(gameDir, { recursive: true });

  const hardened = withHeadMeta(html, buildBundleCspMeta(generationConfig.sentryDsn));
  const snippet = buildErrorReportingSnippet(generationConfig.sentryDsn, slug, release);
  writeFileSync(join(gameDir, 'game.html'), `${hardened}${snippet}`, 'utf8');
  writeJson(join(gameDir, 'meta.json'), meta);
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
  writeJson(paths.manifest, manifest);

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
    ...(kinds === undefined || kinds.length === 0 ? {} : { failureKinds: [...kinds] }),
    ...(attemptModels === undefined || attemptModels.length === 0
      ? {}
      : { attemptModels: [...attemptModels] }),
    ...(quotaAffected ? { quotaAffected: true } : {}),
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
 * @param kinds The same failures as `reasons`, as closed-vocabulary ids,
 *   parallel to it by index. These are what the next generation's prompt
 *   reads directly; `reasons` embed console output from AI-written games and
 *   reach a prompt only by way of the reflection note.
 * @param attemptModels The model each attempt used, parallel to `kinds` by
 *   index — what `checkModels.ts` reads to tell a model that is failing
 *   from one that merely rotated in once.
 * @param quotaAffected Set when any attempt — not necessarily every one —
 *   was refused for provider capacity, so `checkModels.ts` can skip the
 *   whole day rather than blame a model for the account's own cap.
 */
export function recordFailure({
  date,
  model,
  attempts,
  reasons,
  kinds,
  attemptModels,
  quotaExhausted = false,
  quotaAffected = false,
  historyEntries,
  root,
}: {
  date: string;
  model: string;
  attempts: number;
  reasons: readonly string[];
  kinds: readonly FailureKind[];
  attemptModels?: readonly string[];
  /** Set when every attempt failed on provider capacity. Omitted when false. */
  quotaExhausted?: boolean;
  /** Set when any attempt failed on provider capacity. Omitted when false. */
  quotaAffected?: boolean;
  historyEntries: HistoryGameEntry[];
  root?: string;
}): HistoryGameEntry[] {
  const paths = root ? createPaths(root) : defaultPaths;
  if (attemptModels !== undefined && attemptModels.length !== kinds.length) {
    throw new Error(
      `attemptModels (${attemptModels.length}) must be parallel to kinds (${kinds.length})`,
    );
  }
  const updatedEntries = appendEntry(historyEntries, {
    date,
    status: 'failed_kept_previous',
    model,
    attempts,
    failureReasons: reasons.map((reason) => reason.slice(0, MAX_FAILURE_REASON_LENGTH)),
    failureKinds: [...kinds],
    ...(attemptModels === undefined ? {} : { attemptModels: [...attemptModels] }),
    ...(quotaExhausted ? { quotaExhausted: true } : {}),
    ...(quotaAffected ? { quotaAffected: true } : {}),
  });
  writeGamesJson(paths.historyGames, updatedEntries);
  writeGamesMd(paths.historyGamesMd, updatedEntries);
  return updatedEntries;
}

/**
 * Publishes why today produced no game, so the page can say so instead of
 * counting down to a game that is not coming.
 *
 * Only a quota exhaustion earns a file. Every other failure is transient
 * enough that the countdown is still the truthful thing to show. `manifest.json`
 * is untouched either way: it describes the game still being served.
 *
 * @param generatedAt ISO timestamp of the failed run, which `retryAt` counts
 *   forward from.
 * @param cronSchedule When the next run is due, as `config/generation.json`
 *   states it.
 */
export function writeRunStatus({
  date,
  generatedAt,
  cronSchedule,
  root,
}: {
  date: string;
  generatedAt: string;
  cronSchedule: string;
  root?: string;
}): RunStatus {
  const paths = root ? createPaths(root) : defaultPaths;
  const status: RunStatus = {
    date,
    state: QUOTA_EXCEEDED,
    retryAt: computeExpiresAt(cronSchedule, generatedAt),
  };
  writeJson(paths.status, status);
  return status;
}

/**
 * What {@link restoreManifestFromArchive} found.
 *
 * `intact` means the manifest was already naming a bundle that is on disk
 * and nothing was written — the overwhelmingly common case, and the one
 * that keeps a failed run from touching a live site.
 */
export type ManifestRestoreResult =
  { status: 'intact' } | { status: 'restored'; manifest: Manifest } | { status: 'no-candidate' };

/** Options for {@link restoreManifestFromArchive}. */
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
 * {@link Paths.isArchivedFile}, which `assembleSite.ts` asks the same
 * question of before a deploy.
 */
function manifestServesAGame(paths: Paths): boolean {
  if (!existsSync(paths.manifest)) return false;

  const parsed = readJsonOrNull(paths.manifest);
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

  const meta = toGeneratedMeta(readJsonOrNull(join(gameDir, 'meta.json')));
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
    writeJson(paths.manifest, manifest);
    return { status: 'restored', manifest };
  }

  return { status: 'no-candidate' };
}
