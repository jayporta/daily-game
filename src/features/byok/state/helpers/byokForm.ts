// What the visitor has chosen in the BYOK form, as one value.
import type { ByokModelsConfig, ByokProvider } from '#lib/byok-config-types.ts';

/** Which provider and model this run will use, and the key to run it with. */
export interface ByokFormState {
  readonly provider: ByokProvider;
  readonly modelId: string;
  /**
   * The visitor's key. Held here and nowhere else: read once inside the
   * submit handler, cleared on success, and never written to shared state.
   */
  readonly apiKey: string;
}

/**
 * A provider carries its model with it, because a provider left beside
 * another provider's model would describe a request no catalogue entry
 * covers. The action supplies both, so the pair cannot be moved by halves.
 */
export type ByokFormAction =
  | { type: 'provider'; provider: ByokProvider; modelId: string }
  | { type: 'model'; modelId: string }
  | { type: 'apiKey'; apiKey: string };

/** Applies one change to the form. */
export function reduceByokForm(state: ByokFormState, action: ByokFormAction): ByokFormState {
  switch (action.type) {
    case 'provider':
      return { ...state, provider: action.provider, modelId: action.modelId };
    case 'model':
      return { ...state, modelId: action.modelId };
    case 'apiKey':
      return { ...state, apiKey: action.apiKey };
  }
}

/**
 * The first entry in the catalogue, with an empty key.
 *
 * The `?? 'openrouter'` is unreachable past the empty-catalogue guard in the
 * panel; it is there because the type has no empty case.
 */
export function initialByokForm(catalogue: ByokModelsConfig): ByokFormState {
  return {
    provider: catalogue[0]?.provider ?? 'openrouter',
    modelId: catalogue[0]?.models[0]?.id ?? '',
    apiKey: '',
  };
}
