import { useContext } from 'react';
import type { RunStatus } from '#lib/status.ts';
import { RunStatusContext } from '@/features/game/state/context/runStatusContext.ts';

/**
 * What the last run reported, or `null` when it reported nothing.
 *
 * @throws If called outside a `RunStatusProvider`, so a tree wired up wrongly
 *   fails here rather than quietly behaving like a day with nothing to say.
 */
export function useRunStatusContext(): RunStatus | null {
  const status = useContext(RunStatusContext);
  if (status === undefined) {
    throw new Error('useRunStatusContext must be used within a RunStatusProvider');
  }
  return status;
}
