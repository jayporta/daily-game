#!/usr/bin/env node
// Keeping config/models.json in step with what OpenRouter still offers.
//
// Runs only after a day that produced no game, since a rotation entry that
// has quietly disappeared is one reason a run fails on every attempt. The
// catalogue is a free, unauthenticated GET, so this needs no API key and
// spends nothing.
//
// Writes nothing at all unless a configured model has actually gone, and
// refuses to write anything the config's own validator would reject.
import { pathToFileURL } from 'node:url';
import { isRecord } from '#lib/guards.ts';
import {
  loadModelsConfig,
  type ModelEntry,
  type ModelsConfig,
  validateModelsConfig,
} from '#scripts/lib/config/models.ts';
import { isoDate } from '#scripts/lib/dates.ts';
import { type HistoryGameEntry, readHotWindow } from '#scripts/lib/history-store.ts';
import { writeJson } from '#scripts/lib/json-file.ts';
import { createPaths, paths as defaultPaths } from '#scripts/lib/paths.ts';
import { isStringArray } from '#scripts/lib/validation.ts';

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
      readonly added: readonly string[];
      /** The id now moderating, when the previous one had gone. */
      readonly moderationReplacedBy: string | null;
    }
  | { readonly status: 'refused'; readonly reason: string };

/**
 * Whether the day named by `date` ended without a game.
 *
 * Exported so the gate can be checked without a network call: on a day that
 * published, this script does nothing and asks OpenRouter nothing.
 */
export function shouldCheckModels(entries: readonly HistoryGameEntry[], date: string): boolean {
  return entries.some((entry) => entry.date === date && entry.status === 'failed_kept_previous');
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
}: CheckModelsOptions = {}): Promise<CheckModelsResult> {
  const paths = root ? createPaths(root) : defaultPaths;
  const config = loadModelsConfig(paths.modelsConfig);

  const response = await fetchImpl(CATALOG_URL);
  if (!response.ok) {
    throw new Error(`could not load the OpenRouter catalogue (${response.status})`);
  }
  const { liveIds, usable } = readCatalog(await response.json());

  const deadEntries = config.models.filter((entry) => !liveIds.has(entry.id));
  const moderationDead = !liveIds.has(config.moderationModel);
  if (deadEntries.length === 0 && !moderationDead) return { status: 'all-live' };

  const configured = new Set([...config.models.map((entry) => entry.id), config.moderationModel]);
  const candidates = replacementCandidates(usable, configured);

  // One replacement per active model lost, so a disappearance is made good
  // rather than used as licence to grow the rotation.
  const activeLost = deadEntries.filter((entry) => entry.active).length;
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

  const models: ModelEntry[] = [
    ...config.models.filter((entry) => liveIds.has(entry.id)),
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
      return `Removed ${result.removed.join(', ') || 'nothing'}; added ${
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
