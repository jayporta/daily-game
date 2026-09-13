// Everything about `config/genres.json`: its shape, its rules, and how it is
// read. The prompt hands the model this catalogue and lets it choose.
import { paths } from '#scripts/lib/paths.ts';
import {
  isNonEmptyString,
  isPlainObject,
  loadValidatedJson,
  type ValidationResult,
} from '#scripts/lib/validation.ts';

/** One genre the model may choose from. */
export interface GenreEntry {
  /**
   * Stable key, unique within the file. Recorded on a published entry and
   * matched against recent history to mark a genre as recently used.
   */
  readonly id: string;
  /** Human-readable name, shown on the game's card as `genreLabel`. */
  readonly label: string;
  /** Sample games that fit, offered to the model as illustration, not as a menu. */
  readonly examples: string[];
}

/** The parsed `config/genres.json`: the whole catalogue, in file order. */
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
    if (!isNonEmptyString(entry.label))
      errors.push(`genres[${i}].label must be a non-empty string`);
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
