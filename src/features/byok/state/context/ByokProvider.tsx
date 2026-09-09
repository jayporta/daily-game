import { type ReactNode, useState } from 'react';
import { SYSTEM_PROMPT } from '#lib/system-prompt.ts';
import {
  type ByokActions,
  ByokActionsContext,
} from '@/features/byok/state/context/byokActionsContext.ts';
import type { ByokResult } from '@/features/byok/state/context/byokResult.ts';
import { ByokStatusContext } from '@/features/byok/state/context/byokStatusContext.ts';
import { useByok } from '@/features/byok/state/useByok.ts';

export interface ByokProviderProps {
  /** Replaces global `fetch`; injected by tests. */
  readonly fetchImpl?: typeof fetch;
  readonly children: ReactNode;
}

/**
 * Owns a visitor's generation and makes it readable anywhere below.
 *
 * Above the panel that starts a run rather than inside it, because the live
 * output renders in the game's place — which sits above the panel. Passing it
 * down instead would thread it through `GameView`, which needs only the phase.
 */
export function ByokProvider({ fetchImpl, children }: ByokProviderProps) {
  const byok = useByok({ systemPrompt: SYSTEM_PROMPT, ...(fetchImpl ? { fetchImpl } : {}) });
  const [override, setOverride] = useState<ByokResult | null>(null);
  const { status, priorFailureFeedback, generate, stop, clearFeedback } = byok;

  const actions: ByokActions = {
    override,
    priorFailureFeedback,
    generate,
    stop,
    backToTodaysGame: (): void => {
      stop();
      setOverride(null);
    },
    clearFeedback,
    showResult: setOverride,
  };

  return (
    <ByokStatusContext.Provider value={status}>
      <ByokActionsContext.Provider value={actions}>{children}</ByokActionsContext.Provider>
    </ByokStatusContext.Provider>
  );
}
