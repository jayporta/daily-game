// The published manifest for the game on screen, shared with everything that
// renders part of it.
import { createContext } from 'react';
import type { Manifest } from '#lib/manifest.ts';

/**
 * The day's manifest, or `null` where no provider stands above the reader.
 *
 * Read it through {@link useManifestContext}, which turns that `null` into a
 * thrown error rather than letting a mis-wired tree render empty.
 */
export const ManifestContext = createContext<Manifest | null>(null);
