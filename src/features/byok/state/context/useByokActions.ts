import { useContext } from 'react';
import {
  type ByokActions,
  ByokActionsContext,
} from '@/features/byok/state/context/byokActionsContext.ts';

/**
 * The BYOK controls, from the nearest provider above.
 *
 * @throws If called outside a `ByokProvider`. A tree wired up wrongly fails
 *   here, rather than rendering a Generate button that does nothing.
 */
export function useByokActions(): ByokActions {
  const actions = useContext(ByokActionsContext);
  if (actions === null) {
    throw new Error('useByokActions must be used within a ByokProvider');
  }
  return actions;
}
