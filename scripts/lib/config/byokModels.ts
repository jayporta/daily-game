// Everything Node-side about `config/byok-models.json`: its rules and how it
// is read.
//
// Its type and shape guard live in `lib/byok-config-types.ts` instead, not
// here: the browser renders these pickers and so needs them too, and `lib/`
// is the only directory both tsconfigs compile.
import { BYOK_PROVIDERS, isByokProvider, type ByokModelsConfig } from '../../../lib/byok-config-types.ts';
import { paths } from '../paths.ts';
import {
  isNonEmptyString,
  isPlainObject,
  loadValidatedJson,
  type ValidationResult,
} from '../validation.ts';

/**
 * Every provider in {@link BYOK_PROVIDERS} must appear exactly once, since
 * the picker has one fixed slot per provider.
 */
export function validateByokModelsConfig(json: unknown): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(json)) {
    return { valid: false, errors: ['root must be an array'] };
  }

  const seenProviders: string[] = [];
  json.forEach((entry: unknown, i: number) => {
    if (!isPlainObject(entry)) {
      errors.push(`byokModels[${i}] must be an object`);
      return;
    }
    if (!isByokProvider(entry.provider)) {
      errors.push(`byokModels[${i}].provider must be one of: ${BYOK_PROVIDERS.join(', ')}`);
    } else {
      seenProviders.push(entry.provider);
    }
    if (!isNonEmptyString(entry.label)) errors.push(`byokModels[${i}].label must be a non-empty string`);
    if (!Array.isArray(entry.models) || entry.models.length === 0) {
      errors.push(`byokModels[${i}].models must be a non-empty array`);
    } else {
      entry.models.forEach((model: unknown, j: number) => {
        const at = `byokModels[${i}].models[${j}]`;
        if (!isPlainObject(model)) {
          errors.push(`${at} must be an object`);
          return;
        }
        if (!isNonEmptyString(model.id)) errors.push(`${at}.id must be a non-empty string`);
        if (!isNonEmptyString(model.label)) errors.push(`${at}.label must be a non-empty string`);
      });
    }
  });

  for (const provider of BYOK_PROVIDERS) {
    const count = seenProviders.filter((p) => p === provider).length;
    if (count === 0) errors.push(`byokModels is missing provider "${provider}"`);
    if (count > 1) errors.push(`byokModels lists provider "${provider}" more than once`);
  }

  return { valid: errors.length === 0, errors };
}

/** @throws If the file is missing, unparseable, or fails {@link validateByokModelsConfig}. */
export function loadByokModelsConfig(filePath: string = paths.byokModelsConfig): ByokModelsConfig {
  return loadValidatedJson<ByokModelsConfig>(filePath, validateByokModelsConfig);
}
