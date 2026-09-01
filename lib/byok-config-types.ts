// Shape of config/byok-models.json — the hand-maintained catalogue behind
// the BYOK provider/model pickers. Lives in lib/ (not scripts/lib/ or
// src/lib/) because both the browser (to render the pickers) and the Node
// validator need the identical shape.
//
// Hand-maintained like config/models.json's rotation: model ids drift as
// providers release new ones, so this file needs periodic review rather
// than one-time seeding.
import { isRecord } from '#lib/guards.ts';

/** The four providers a BYOK generation can run against. */
export const BYOK_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'gemini'] as const;

/** One of {@link BYOK_PROVIDERS}. */
export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

const PROVIDER_IDS: ReadonlySet<string> = new Set(BYOK_PROVIDERS);

/** Narrows an untrusted value to a known {@link ByokProvider}. */
export function isByokProvider(value: unknown): value is ByokProvider {
  return typeof value === 'string' && PROVIDER_IDS.has(value);
}

export interface ByokModelEntry {
  /** The provider's own model id string, sent verbatim in the request. */
  readonly id: string;
  /** Shown in the model picker. */
  readonly label: string;
}

export interface ByokProviderConfig {
  readonly provider: ByokProvider;
  /** Shown in the provider picker. */
  readonly label: string;
  readonly models: readonly ByokModelEntry[];
}

/** Contents of `config/byok-models.json`: one entry per {@link ByokProvider}. */
export type ByokModelsConfig = readonly ByokProviderConfig[];

function isByokModelEntry(value: unknown): value is ByokModelEntry {
  if (!isRecord(value)) return false;
  if (!('id' in value) || !('label' in value)) return false;
  return typeof value.id === 'string' && value.id.length > 0 && typeof value.label === 'string' && value.label.length > 0;
}

function isByokProviderConfig(value: unknown): value is ByokProviderConfig {
  if (!isRecord(value)) return false;
  if (!('provider' in value) || !('label' in value) || !('models' in value)) return false;
  const { provider, label, models } = value;
  if (!isByokProvider(provider)) return false;
  if (typeof label !== 'string' || label.length === 0) return false;
  return Array.isArray(models) && models.length > 0 && models.every(isByokModelEntry);
}

/** Shape check for the hand-edited config file. */
export function isByokModelsConfig(value: unknown): value is ByokModelsConfig {
  return Array.isArray(value) && value.every(isByokProviderConfig);
}
