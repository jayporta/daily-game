// Loads and validates every config file. The "read → parse → validate →
// typed value" sequence lives here once so the pipeline, the publish step
// and the CI validation step all fail identically on a bad hand-edit.
import { readFileSync } from 'node:fs';
import { paths } from './paths.ts';
import {
  validateGenerationConfig,
  validateGenresConfig,
  validateModelsConfig,
} from './schema.ts';
import type {
  GenerationConfig,
  GenresConfig,
  ModelsConfig,
  ValidationResult,
} from './types.ts';

export function loadValidatedJson<T>(
  filePath: string,
  validate: (json: unknown) => ValidationResult,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${filePath}: could not read or parse JSON — ${(error as Error).message}`);
  }

  const result = validate(parsed);
  if (!result.valid) {
    throw new Error(`${filePath}: invalid — ${result.errors.join('; ')}`);
  }
  return parsed as T;
}

export function loadModelsConfig(filePath: string = paths.modelsConfig): ModelsConfig {
  return loadValidatedJson<ModelsConfig>(filePath, validateModelsConfig);
}

export function loadGenresConfig(filePath: string = paths.genresConfig): GenresConfig {
  return loadValidatedJson<GenresConfig>(filePath, validateGenresConfig);
}

export function loadGenerationConfig(filePath: string = paths.generationConfig): GenerationConfig {
  return loadValidatedJson<GenerationConfig>(filePath, validateGenerationConfig);
}

/** Guardrails are markdown, injected verbatim into generation + moderation prompts. */
export function loadGuardrails(filePath: string = paths.guardrails): string {
  const text = readFileSync(filePath, 'utf8').trim();
  if (text.length === 0) {
    throw new Error(`${filePath}: guardrails must not be empty`);
  }
  return text;
}

export interface LoadedConfig {
  models: ModelsConfig;
  genres: GenresConfig;
  generation: GenerationConfig;
  guardrails: string;
}

/** Convenience for callers that need everything (the daily pipeline does). */
export function loadAllConfig(): LoadedConfig {
  return {
    models: loadModelsConfig(),
    genres: loadGenresConfig(),
    generation: loadGenerationConfig(),
    guardrails: loadGuardrails(),
  };
}
