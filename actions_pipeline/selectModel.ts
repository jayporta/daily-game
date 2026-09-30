// Round-robin model selection over the active entries in models.json.
// Disabled entries are skipped entirely, so the user can turn a model off
// by flipping `active: false` without removing it from the rotation list.
import type { ModelEntry, ModelsConfig } from '#actions_pipeline/lib/config/models.ts';

/**
 * The rotation: every entry in `models.json` marked `active: true`, in file
 * order.
 *
 * The length caps an ordinary run's attempts — each active model is reached at
 * most once, as a primary or a fallback, so a run can end early — and adding
 * or disabling an entry changes how many attempts a failing day can get.
 *
 * @param config - The parsed `config/models.json`.
 * @returns The active entries, which may be empty if every model is disabled.
 */
export function activeModels(config: ModelsConfig): ModelEntry[] {
  return config.models.filter((model) => model.active);
}

/**
 * Returns the model following `lastUsedModelId` in the active rotation,
 * wrapping at the end. Falls back to the first active model when the last
 * used id is unknown (first ever run, or a model since disabled/removed).
 *
 * @param config - The parsed `config/models.json`.
 * @param lastUsedModelId - The `id` the previous attempt used, if there was one.
 * @returns The next entry to try.
 *
 * @throws {Error} When no entry in `config` is marked `active: true`.
 */
export function selectNextModel(config: ModelsConfig, lastUsedModelId?: string): ModelEntry {
  const active = activeModels(config);
  const first = active[0];
  if (!first) {
    throw new Error('select-model: models.json has no entries with active: true');
  }

  if (lastUsedModelId === undefined) return first;

  const lastIndex = active.findIndex((model) => model.id === lastUsedModelId);
  if (lastIndex === -1) return first;

  // Wrapping past the end lands on `first`, which is also the fallback
  // `noUncheckedIndexedAccess` requires.
  return active[(lastIndex + 1) % active.length] ?? first;
}

/**
 * The models after `primary` in the active rotation, in order and wrapping at
 * the end, for a request to fall back to.
 *
 * The walk visits each rotation entry at most once, so it ends even when
 * `primary` is not in the rotation.
 *
 * @param config - The parsed `config/models.json`.
 * @param primary - The model the request is for. Never in the result, even
 *   when the walk wraps back to it.
 * @param count - The most fallbacks wanted. A rotation with fewer other
 *   models than this yields fewer, and a rotation of one yields none.
 * @param skip - Ids the walk passes over without listing, such as models an
 *   earlier attempt already reached. Empty by default.
 * @returns Distinct ids, none equal to `primary` or in `skip`.
 *
 * @throws {Error} When no entry in `config` is marked `active: true` and
 *   `count` is above zero.
 */
export function fallbackModelsAfter(
  config: ModelsConfig,
  primary: string,
  count: number,
  skip: ReadonlySet<string> = new Set(),
): string[] {
  const ids: string[] = [];
  const visited = new Set<string>();
  let current = primary;
  while (ids.length < count) {
    const next = selectNextModel(config, current).id;
    if (next === primary || visited.has(next)) break;
    visited.add(next);
    if (!skip.has(next)) ids.push(next);
    current = next;
  }
  return ids;
}
