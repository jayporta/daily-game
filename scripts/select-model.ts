import type { ModelEntry, ModelsConfig } from '#scripts/lib/config/models.ts';
// Round-robin model selection over the active entries in models.json.
// Disabled entries are skipped entirely, so the user can turn a model off
// by flipping `active: false` without removing it from the rotation list.

export function activeModels(config: ModelsConfig): ModelEntry[] {
  return config.models.filter((model) => model.active);
}

/**
 * Returns the model following `lastUsedModelId` in the active rotation,
 * wrapping at the end. Falls back to the first active model when the last
 * used id is unknown (first ever run, or a model since disabled/removed).
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
