// Everything about `config/models.json`: its shape, its rules, and how it
// is read. The daily pipeline picks each attempt's model from this rotation.
import { paths } from '#scripts/lib/paths.ts';
import {
  isNonEmptyString,
  isPlainObject,
  loadValidatedJson,
  type ValidationResult,
} from '#scripts/lib/validation.ts';

export interface ModelEntry {
  readonly id: string;
  readonly active: boolean;
  readonly provider: string;
}

export interface ModelsConfig {
  readonly moderationModel: string;
  readonly models: ModelEntry[];
}

/**
 * At least one entry must be active: an all-inactive rotation would leave
 * the run with no model to call and no way to say why.
 *
 * The moderation model must also stay out of the active rotation, so it
 * never grades its own generation.
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
    json.models.forEach((entry: unknown, i: number) => {
      if (!isPlainObject(entry)) {
        errors.push(`models[${i}] must be an object`);
        return;
      }
      if (!isNonEmptyString(entry.id)) errors.push(`models[${i}].id must be a non-empty string`);
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
