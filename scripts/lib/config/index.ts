// The one convenience the daily pipeline needs: every load-bearing config in
// a single call.
//
// Deliberately not a barrel. Import a single config from its own module
// (`config/models.ts`) rather than re-exporting it here — an import that
// names the file it comes from is one less hop when you are trying to find
// where something is defined.
import { type GenerationConfig, loadGenerationConfig } from '#scripts/lib/config/generation.ts';
import { type GenresConfig, loadGenresConfig } from '#scripts/lib/config/genres.ts';
import { loadGuardrails } from '#scripts/lib/config/guardrails.ts';
import { loadModelsConfig, type ModelsConfig } from '#scripts/lib/config/models.ts';

export interface LoadedConfig {
  models: ModelsConfig;
  genres: GenresConfig;
  generation: GenerationConfig;
  guardrails: string;
}

/**
 * Loads everything the daily run needs, failing on the first broken file.
 *
 * The reaction config is deliberately absent: it is decoration, loaded
 * separately through `loadReactionConfigOrUnconfigured` so a hand-edit that
 * breaks it cannot cost the day its game.
 *
 * @throws If any config file is missing, unparseable or invalid.
 */
export function loadAllConfig(): LoadedConfig {
  return {
    models: loadModelsConfig(),
    genres: loadGenresConfig(),
    generation: loadGenerationConfig(),
    guardrails: loadGuardrails(),
  };
}
