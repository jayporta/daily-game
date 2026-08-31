// Everything about `config/genres.json`: its shape, its rules, and how it is
// read. The prompt hands the model this catalogue and lets it choose.
import { paths } from '../paths.ts';
import {
  isNonEmptyString,
  isPlainObject,
  loadValidatedJson,
  type ValidationResult,
} from '../validation.ts';

export interface GenreEntry {
  id: string;
  label: string;
  examples: string[];
}

export type GenresConfig = GenreEntry[];

/** Ids must be unique: they key the "recently used" marking in the prompt. */
export function validateGenresConfig(json: unknown): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(json)) {
    return { valid: false, errors: ['root must be an array'] };
  }
  if (json.length === 0) errors.push('genres must not be empty');

  const seenIds = new Set<string>();
  json.forEach((entry: unknown, i: number) => {
    if (!isPlainObject(entry)) {
      errors.push(`genres[${i}] must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.id)) {
      errors.push(`genres[${i}].id must be a non-empty string`);
    } else if (seenIds.has(entry.id)) {
      errors.push(`genres[${i}].id "${entry.id}" is duplicated`);
    } else {
      seenIds.add(entry.id);
    }
    if (!isNonEmptyString(entry.label)) errors.push(`genres[${i}].label must be a non-empty string`);
    if (
      !Array.isArray(entry.examples) ||
      entry.examples.length === 0 ||
      entry.examples.some((e: unknown) => !isNonEmptyString(e))
    ) {
      errors.push(`genres[${i}].examples must be a non-empty array of non-empty strings`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/** @throws If the file is missing, unparseable, or fails {@link validateGenresConfig}. */
export function loadGenresConfig(filePath: string = paths.genresConfig): GenresConfig {
  return loadValidatedJson<GenresConfig>(filePath, validateGenresConfig);
}
