import { useContext } from 'react';
import { ByokStatusContext } from '@/features/byok/state/context/byokStatusContext.ts';
import type { ByokStatus } from '@/features/byok/state/useByok.ts';

/**
 * What a visitor's generation is doing, from the nearest provider above.
 *
 * @throws If called outside a `ByokProvider`. A tree wired up wrongly fails
 *   here, rather than rendering a console that never fills.
 */
export function useByokStatus(): ByokStatus {
  const status = useContext(ByokStatusContext);
  if (status === null) {
    throw new Error('useByokStatus must be used within a ByokProvider');
  }
  return status;
}
