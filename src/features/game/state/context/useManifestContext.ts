import { useContext } from 'react';
import type { Manifest } from '#lib/manifest.ts';
import { ManifestContext } from '@/features/game/state/context/manifestContext.ts';

/**
 * The day's manifest, from the nearest provider above.
 *
 * @throws If called outside a `ManifestProvider`. A tree wired up wrongly
 *   fails here, rather than rendering a card with nothing in it.
 */
export function useManifestContext(): Manifest {
  const manifest = useContext(ManifestContext);
  if (manifest === null) {
    throw new Error('useManifestContext must be used within a ManifestProvider');
  }
  return manifest;
}
