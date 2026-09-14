#!/usr/bin/env node
// Keeping config/models.json in step with what OpenRouter still offers.
//
// Runs after any day that recorded a failed attempt — one that produced no
// game at all, or one that published only after an earlier model failed. A
// rotation entry that has quietly disappeared is one reason a run fails on
// every attempt, and a model rescued by a later one every single day shows
// up no other way. The catalogue is a free, unauthenticated GET, so this
// needs no API key and spends nothing.
//
// Writes nothing at all unless a configured model has actually gone, and
// refuses to write anything the config's own validator would reject.
import { pathToFileURL } from 'node:url';
import { isRecord } from '#lib/guards.ts';
import { loadGenerationConfig } from '#scripts/lib/config/generation.ts';
import {
  loadModelsConfig,
  type ModelEntry,
  type ModelsConfig,
  validateModelsConfig,
} from '#scripts/lib/config/models.ts';
import { isoDate } from '#scripts/lib/dates.ts';
import {
  type FailureKind,
  type HistoryGameEntry,
  isPublished,
  readHotWindow,
} from '#scripts/lib/history-store.ts';
import { writeJson } from '#scripts/lib/json-file.ts';
import { createPaths, paths as defaultPaths } from '#scripts/lib/paths.ts';
import { isStringArray } from '#scripts/lib/validation.ts';
import { splitAging } from '#scripts/rollup-history.ts';

export const CATALOG_URL = 'https://openrouter.ai/api/v1/models';

/**
 * The smallest output a replacement may be capped at.
 *
 * A complete HTML game runs to roughly 8-20k tokens, so anything at the 8k
 * tier truncates mid-bundle and loses its closing fence, which the extractor
 * can only report as a missing block. It also keeps classifier models, which
 * cluster at that cap, out of a rotation meant to write games.
 */
export const MIN_OUTPUT_TOKENS = 16_384;

/**
 * Distinct hot-window days of evidence a model needs before its reliability
 * is judged at all. One bad day is the rotation's own noise — a provider
 * outage can fail every model attempted that day — not evidence against any
 * one of them.
 */
export const MIN_UNRELIABLE_DAYS = 3;

/**
 * The share of a model's judged days that must have failed at the
 * generation call — a fault of the provider or the model, never something
 * the pipeline's own gates rejected — before it is dropped for
 * unreliability rather than delisting.
 */
export const UNRELIABLE_FAILURE_RATE = 0.75;

/**
 * Above this share of one day's attempts failing at the generation call,
 * that day reads as a rotation-wide outage rather than evidence against any
 * one model, and none of its attempts count as evidence for anything.
 */
export const ROTATION_WIDE_FAILURE_RATE = 0.5;

/** A catalogue entry, reduced to the fields that decide anything here. */
export interface CatalogModel {
  readonly id: string;
  readonly name: string;
  readonly outputModalities: readonly string[];
  readonly maxOutputTokens: number;
}

/** What a run of {@link checkModels} did. */
export type CheckModelsResult =
  | { readonly status: 'all-live' }
  | {
      readonly status: 'updated';
      readonly removed: readonly string[];
      /** Removed ids for failing too often, rather than being delisted. */
      readonly removedUnreliable: readonly string[];
      readonly added: readonly string[];
      /** The id now moderating, when the previous one had gone. */
      readonly moderationReplacedBy: string | null;
    }
  | { readonly status: 'refused'; readonly reason: string };

/**
 * Whether the day named by `date` left a failed attempt to learn from.
 *
 * True for a day that produced no game, and for one that published only
 * after an earlier model failed: {@link modelReliability} reads both, and a
 * model rescued by a later one every single day produces nothing else. A day
 * whose first attempt won records no `attemptModels`, so the common case
 * still asks OpenRouter nothing.
 *
 * Exported so the gate can be checked without a network call.
 */
export function shouldCheckModels(entries: readonly HistoryGameEntry[], date: string): boolean {
  return entries.some(
    (entry) =>
      entry.date === date &&
      (entry.status === 'failed_kept_previous' ||
        (entry.attemptModels !== undefined && entry.attemptModels.length > 0)),
  );
}

/** Narrows one catalogue entry, or `null` when it is too partial to judge. */
function toCatalogModel(value: unknown): CatalogModel | null {
  if (!isRecord(value)) return null;
  const { id, name, architecture, top_provider: provider } = value;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (!isRecord(architecture) || !isRecord(provider)) return null;
  const modalities = architecture['output_modalities'];
  const maxTokens = provider['max_completion_tokens'];
  if (!isStringArray(modalities)) return null;
  if (typeof maxTokens !== 'number') return null;
  return {
    id,
    name: typeof name === 'string' ? name : id,
    outputModalities: modalities,
    maxOutputTokens: maxTokens,
  };
}

/**
 * Every id the catalogue lists, and the subset usable as a replacement.
 *
 * The two are gathered separately because an entry too partial to judge is
 * still proof that its id is alive, and dropping it would read as a model
 * having disappeared.
 *
 * @throws If the response is not the documented `{ data: [...] }` shape.
 */
export function readCatalog(value: unknown): {
  liveIds: ReadonlySet<string>;
  usable: readonly CatalogModel[];
} {
  if (!isRecord(value) || !Array.isArray(value['data'])) {
    throw new Error('OpenRouter catalogue was not a { data: [...] } response');
  }
  const liveIds = new Set<string>();
  const usable: CatalogModel[] = [];
  for (const raw of value['data']) {
    if (isRecord(raw) && typeof raw['id'] === 'string') liveIds.add(raw['id']);
    const model = toCatalogModel(raw);
    if (model !== null) usable.push(model);
  }
  return { liveIds, usable };
}

/**
 * One model's hot-window record: how many days it was judged, and how many
 * of those days it failed at the generation call.
 */
export interface ModelReliability {
  readonly days: number;
  readonly generationCallDays: number;
}

/**
 * Tallies each model's hot-window days and how many were a generation-call
 * failure.
 *
 * The unit of evidence is one day, not one attempt: a forced run makes
 * `FORCED_MODEL_ATTEMPTS` attempts on a single id, and counting each would
 * let one such day outweigh several days of ordinary rotation. Where a
 * model was attempted more than once in a day, the day's kind is its first
 * attempt's — the common case is every attempt sharing one outcome, and
 * nothing here needs finer resolution than "this day was, or was not,
 * evidence against this model."
 *
 * A day is skipped entirely, contributing no evidence for or against
 * anything, when: it predates `attemptModels` (nothing to attribute a
 * failure to); it was `quotaExhausted` or `quotaAffected` (an account-level
 * cap, never a model's fault, whether it hit every attempt that day or
 * only some); or it produced no game while exercising more than one
 * distinct model — proven ones included — and more than {@link
 * ROTATION_WIDE_FAILURE_RATE} of them failed at the generation call, which
 * reads as a provider-wide outage rather than a problem with any one model
 * — the exact shape of 2026-09-08 through 2026-09-10, when every active
 * model was attempted once and most were refused by the provider. That last
 * test is confined to days that published nothing because a day that
 * published cannot be an outage: the rotation produced a game, so every
 * attempt that lost before it lost on its own account, and counting the
 * winner into the ratio instead would still discard two ordinary failures
 * before a success. Judging this by distinct models rather than raw
 * attempts is what keeps it from also discarding a forced run: pinned to
 * one id, such a run can never look "rotation-wide" no matter how many
 * times that one id failed.
 *
 * A model that published inside the same window is exempt from the tally,
 * but only after the rotation-wide judgment above has already been made
 * against the day's full rotation — counting only unproven models there
 * would let a day with just one unproven model left dodge the check
 * outright, and take a strike a provider-wide outage was never meant to
 * leave it with. A failed run only ever records the attempts that lost, so
 * this tally can only ever accumulate evidence against a model, never for
 * one — a model with a fresh success needs no defense against a run it
 * took no part in.
 *
 * Reads `attemptModels`/`failureKinds`, a closed-vocabulary pair written by
 * `publish.ts`, never `failureReasons` — so nothing here parses prose to
 * decide anything.
 *
 * A `published` entry carries the same pair for attempts that failed before
 * the day's eventual success, so it is read here too — without that, a
 * model rescued every day by a later one in the rotation would fail its own
 * attempt every single day and never accumulate any evidence at all.
 */
export function modelReliability(
  entries: readonly HistoryGameEntry[],
): ReadonlyMap<string, ModelReliability> {
  const proven = new Set(entries.filter(isPublished).map((entry) => entry.model));
  const tally = new Map<string, { days: number; generationCallDays: number }>();

  for (const entry of entries) {
    if (entry.attemptModels === undefined) continue;
    // `quotaExhausted` only exists on a failed entry — a published day, by
    // definition, did not have every attempt fail.
    const quotaExhausted = entry.status === 'failed_kept_previous' && entry.quotaExhausted === true;
    if (quotaExhausted || entry.quotaAffected === true) continue;

    const { failureKinds, attemptModels } = entry;
    if (failureKinds === undefined) continue;

    // One entry per distinct model attempted that day, keyed to its first
    // attempt's kind — a forced run repeats a single id several times, and
    // that is one day of evidence, not several. Built from every model
    // attempted, proven or not: the rotation-wide check just below has to
    // judge the day the rotation actually had, not a narrower one with that
    // day's published models already subtracted out — a day with exactly
    // one *unproven* model left would otherwise dodge the check outright.
    const dayKindByModel = new Map<string, FailureKind>();
    failureKinds.forEach((kind, index) => {
      const id = attemptModels[index];
      if (id === undefined || dayKindByModel.has(id)) return;
      dayKindByModel.set(id, kind);
    });

    // A day that exercised more than one model, most of which failed at the
    // generation call, reads as a provider-wide outage rather than evidence
    // against any one of them — the exact shape of 2026-09-08 through
    // 2026-09-10, when every active model was attempted once and most were
    // refused by the provider. A day that published is never that shape: the
    // rotation produced a game, so each attempt that lost before it lost on
    // its own account. A forced run tries exactly one model, so its failures
    // can never be discarded this way either.
    if (!isPublished(entry) && dayKindByModel.size > 1) {
      const generationCallModels = [...dayKindByModel.values()].filter(
        (kind) => kind === 'generation-call',
      ).length;
      if (generationCallModels / dayKindByModel.size > ROTATION_WIDE_FAILURE_RATE) continue;
    }

    // Proven models are excluded here, after the rotation-wide judgment
    // above rather than before it — a model that published elsewhere in the
    // window still took part in this day's rotation, and removing it first
    // would shrink the denominator that decides whether the day counts at
    // all.
    for (const [id, kind] of dayKindByModel) {
      if (proven.has(id)) continue;
      const current = tally.get(id) ?? { days: 0, generationCallDays: 0 };
      current.days += 1;
      if (kind === 'generation-call') current.generationCallDays += 1;
      tally.set(id, current);
    }
  }
  return tally;
}

/**
 * Ids whose hot-window days fail on the provider's side too often to keep in
 * rotation, regardless of whether OpenRouter still lists them.
 *
 * @param entries The hot window, as {@link readHotWindow} returns it.
 */
export function unreliableModelIds(entries: readonly HistoryGameEntry[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [id, stats] of modelReliability(entries)) {
    if (stats.days < MIN_UNRELIABLE_DAYS) continue;
    if (stats.generationCallDays / stats.days >= UNRELIABLE_FAILURE_RATE) ids.add(id);
  }
  return ids;
}

/**
 * Free text-only models big enough to write a game, best first.
 *
 * Filtered on the `:free` id suffix rather than on price: some zero-priced
 * entries are audio models or router aliases, which the suffix excludes.
 * Ordered by output cap, then by id so a run is repeatable.
 */
export function replacementCandidates(
  usable: readonly CatalogModel[],
  configured: ReadonlySet<string>,
): readonly CatalogModel[] {
  return usable
    .filter(
      (model) =>
        model.id.endsWith(':free') &&
        !configured.has(model.id) &&
        model.maxOutputTokens >= MIN_OUTPUT_TOKENS &&
        model.outputModalities.length === 1 &&
        model.outputModalities[0] === 'text',
    )
    .sort((a, b) => b.maxOutputTokens - a.maxOutputTokens || a.id.localeCompare(b.id));
}

export interface CheckModelsOptions {
  /** Replaces global `fetch`, so tests answer with a scripted catalogue. */
  readonly fetchImpl?: typeof fetch;
  /** Overrides the repo root, so tests write to a scratch directory. */
  readonly root?: string;
  /** Reports what would change and writes nothing. */
  readonly dryRun?: boolean;
  /** Overrides the clock the hot-window cutoff is measured back from. */
  readonly now?: Date;
}

/**
 * Prunes models OpenRouter no longer lists and refills the rotation.
 *
 * @throws If the catalogue cannot be fetched or read. A run that cannot see
 *   the catalogue must not conclude that every model has disappeared.
 */
export async function checkModels({
  fetchImpl = fetch,
  root,
  dryRun = false,
  now = new Date(),
}: CheckModelsOptions = {}): Promise<CheckModelsResult> {
  const paths = root ? createPaths(root) : defaultPaths;
  const config = loadModelsConfig(paths.modelsConfig);
  const generationConfig = loadGenerationConfig(paths.generationConfig);
  // readHotWindow reads the whole file, not a bounded window — see its own
  // doc comment on historyHotWindowDays: that cutoff is what a rollup
  // applies, not a bound games.json enforces on itself. Applying it here is
  // what keeps unreliableModelIds from pruning a model on evidence from
  // before a rollup last ran.
  const historyEntries = splitAging(readHotWindow(paths.historyGames), generationConfig, now).keep;

  const response = await fetchImpl(CATALOG_URL);
  if (!response.ok) {
    throw new Error(`could not load the OpenRouter catalogue (${response.status})`);
  }
  const { liveIds, usable } = readCatalog(await response.json());

  const deadEntries = config.models.filter((entry) => !liveIds.has(entry.id));
  // Judged only among models still live and still active — a model already
  // dropped for being delisted needs no second reason, and an inactive one
  // is not costing the rotation any attempts.
  const unreliable = unreliableModelIds(historyEntries);
  const unreliableEntries = config.models.filter(
    (entry) => entry.active && liveIds.has(entry.id) && unreliable.has(entry.id),
  );
  const moderationDead = !liveIds.has(config.moderationModel);
  if (deadEntries.length === 0 && unreliableEntries.length === 0 && !moderationDead) {
    return { status: 'all-live' };
  }

  const removedEntries = [...deadEntries, ...unreliableEntries];
  // Includes every unreliable id, not only the ones dropped this run, so a
  // replacement slot opened by one prune can never be refilled by an id the
  // same hot-window evidence already marks unreliable.
  const configured = new Set([
    ...config.models.map((entry) => entry.id),
    config.moderationModel,
    ...unreliable,
  ]);
  const candidates = replacementCandidates(usable, configured);

  // One replacement per active model lost — delisted or unreliable — so a
  // disappearance is made good rather than used as licence to grow the
  // rotation.
  const activeLost = removedEntries.filter((entry) => entry.active).length;
  const chosen = candidates.slice(0, activeLost);
  const moderationReplacement = moderationDead ? (candidates[activeLost] ?? null) : null;

  // A rotation pruned around a moderator that is still gone reads as repaired
  // while every attempt keeps failing closed against an unreachable one.
  if (moderationDead && moderationReplacement === null) {
    return {
      status: 'refused',
      reason: `moderationModel ${config.moderationModel} is gone and no free candidate is left to replace it`,
    };
  }

  const removedIds = new Set(removedEntries.map((entry) => entry.id));
  const models: ModelEntry[] = [
    ...config.models.filter((entry) => liveIds.has(entry.id) && !removedIds.has(entry.id)),
    ...chosen.map((model) => ({ id: model.id, active: true, provider: 'openrouter' })),
  ];
  const updated: ModelsConfig = {
    moderationModel: moderationReplacement?.id ?? config.moderationModel,
    models,
  };

  // The file's own validator, rather than a second copy of its rules here:
  // `npm run validate` runs before any API call, so a config this leaves
  // broken would take out the next day's run before it started.
  const validation = validateModelsConfig(updated);
  if (!validation.valid) {
    return { status: 'refused', reason: validation.errors.join('; ') };
  }

  if (!dryRun) {
    writeJson(paths.modelsConfig, updated);
  }
  return {
    status: 'updated',
    removed: deadEntries.map((entry) => entry.id),
    removedUnreliable: unreliableEntries.map((entry) => entry.id),
    added: chosen.map((model) => model.id),
    moderationReplacedBy: moderationReplacement?.id ?? null,
  };
}

/** One line per outcome, for a workflow log. */
function describe(result: CheckModelsResult): string {
  switch (result.status) {
    case 'all-live':
      return 'Every configured model is still listed — nothing to do';
    case 'refused':
      return `Refused to write config/models.json: ${result.reason}`;
    case 'updated': {
      const moderation =
        result.moderationReplacedBy === null
          ? ''
          : `, moderation now ${result.moderationReplacedBy}`;
      const unreliableNote =
        result.removedUnreliable.length === 0
          ? ''
          : `; dropped ${result.removedUnreliable.join(', ')} for unreliability`;
      return `Removed ${result.removed.join(', ') || 'nothing'}${unreliableNote}; added ${
        result.added.join(', ') || 'nothing'
      }${moderation}`;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const today = isoDate(new Date());
  // A hand-run check is always allowed; the workflow's is gated on the day
  // having produced no game.
  const forced = dryRun || process.argv.includes('--force');
  const entries = readHotWindow(defaultPaths.historyGames);

  if (!forced && !shouldCheckModels(entries, today)) {
    console.log(`${today} did not fail — not asking OpenRouter anything`);
  } else {
    const result = await checkModels({ dryRun });
    console.log(dryRun ? `[dry-run] ${describe(result)}` : describe(result));
    if (result.status === 'refused') process.exitCode = 1;
  }
}
