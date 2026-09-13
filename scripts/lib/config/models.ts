// Everything about `config/models.json`: its shape, its rules, and how it
// is read. The daily pipeline picks each attempt's model from this rotation.
import { paths } from '#scripts/lib/paths.ts';
import {
  isNonEmptyString,
  isPlainObject,
  loadValidatedJson,
  type ValidationResult,
} from '#scripts/lib/validation.ts';

/** One model in the daily rotation. */
export interface ModelEntry {
  /**
   * OpenRouter model id, such as `openai/gpt-4o-mini`. Expected to be unique
   * across the file, though nothing validates that — unlike a genre id.
   */
  readonly id: string;
  /**
   * Whether the rotation includes this entry. Set `false` to retire a model
   * without deleting it — an ordinary run attempts each active entry once, so
   * this also changes how many attempts a failing day gets.
   */
  readonly active: boolean;
  /** Who serves the model, for the run log and the front-end credit. */
  readonly provider: string;
}

/** The parsed `config/models.json`. */
export interface ModelsConfig {
  /**
   * Model id asked to judge generated games. Separate from the rotation: it
   * never writes a game, and a game is never judged by the model that wrote it.
   */
  readonly moderationModel: string;
  /**
   * Every entry, inactive ones included. `activeModels` in `select-model.ts`
   * filters this down to the rotation attempts actually walk, so the two are
   * not interchangeable. At least one entry must be active.
   */
  readonly models: ModelEntry[];
}

/**
 * At least one entry must be active: an all-inactive rotation would leave
 * the run with no model to call and no way to say why.
 *
 * The moderation model must also stay out of the active rotation, so it
 * never grades its own generation.
 *
 * Ids must be unique across the whole file, active or not. A duplicate
 * active id can break the round-robin in `selectNextModel`: its `findIndex`
 * lookup always resolves to the first copy, so depending on where the copies
 * sit the rotation can loop between them and never reach the models past
 * them, while `maxAttempts` still counts the full list.
 */
export function validateModelsConfig(json: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(json)) {
    return { valid: false, errors: ['root must be an object'] };
  }

  if (!isNonEmptyString(json.moderationModel)) {
    errors.push('moderationModel must be a non-empty string');
  }

  if (!Array.isArray(json.models)) {
    errors.push('models must be an array');
  } else {
    if (json.models.length === 0) errors.push('models must not be empty');
    const seenIds = new Set<string>();
    json.models.forEach((entry: unknown, i: number) => {
      if (!isPlainObject(entry)) {
        errors.push(`models[${i}] must be an object`);
        return;
      }
      if (!isNonEmptyString(entry.id)) {
        errors.push(`models[${i}].id must be a non-empty string`);
      } else if (seenIds.has(entry.id)) {
        errors.push(`models[${i}].id "${entry.id}" is duplicated`);
      } else {
        seenIds.add(entry.id);
      }
      if (typeof entry.active !== 'boolean') errors.push(`models[${i}].active must be a boolean`);
      if (!isNonEmptyString(entry.provider))
        errors.push(`models[${i}].provider must be a non-empty string`);
    });
    const hasActiveModel = json.models.some((m: unknown) => isPlainObject(m) && m.active === true);
    if (!hasActiveModel) {
      errors.push('models must contain at least one entry with active: true');
    }

    // A generator that moderates itself is not a second opinion.
    const moderatesItself = json.models.some(
      (m: unknown) => isPlainObject(m) && m.active === true && m.id === json.moderationModel,
    );
    if (moderatesItself) {
      errors.push('moderationModel must not also be an active entry in models');
    }
  }

  return { valid: errors.length === 0, errors };
}

/** @throws If the file is missing, unparseable, or fails {@link validateModelsConfig}. */
export function loadModelsConfig(filePath: string = paths.modelsConfig): ModelsConfig {
  return loadValidatedJson<ModelsConfig>(filePath, validateModelsConfig);
}
