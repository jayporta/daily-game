// What a visitor's generation is doing right now, shared with the console
// that renders it.
import { createContext } from 'react';
import type { ByokStatus } from '@/features/byok/state/useByok.ts';

/**
 * The run in progress, or `null` where no provider stands above the reader.
 *
 * Separate from {@link ByokActionsContext} because this changes on every
 * streamed fragment while that changes only at the edges of a run. Read it
 * through {@link useByokStatus}.
 */
export const ByokStatusContext = createContext<ByokStatus | null>(null);
