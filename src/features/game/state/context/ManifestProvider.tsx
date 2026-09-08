import type { ReactNode } from 'react';
import type { Manifest } from '#lib/manifest.ts';
import { ManifestContext } from '@/features/game/state/context/manifestContext.ts';

export interface ManifestProviderProps {
  /** The day's manifest, as the app loaded it. */
  readonly manifest: Manifest;
  readonly children: ReactNode;
}

/** Makes the day's manifest readable anywhere below, without passing it down. */
export function ManifestProvider({ manifest, children }: ManifestProviderProps) {
  return <ManifestContext.Provider value={manifest}>{children}</ManifestContext.Provider>;
}
