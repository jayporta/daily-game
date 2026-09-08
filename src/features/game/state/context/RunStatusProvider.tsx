import { type ReactNode, useEffect, useState } from 'react';
import type { RunStatus } from '#lib/status.ts';
import { RunStatusContext } from '@/features/game/state/context/runStatusContext.ts';
import { fetchRunStatus, isRetryTimePast } from '@/features/game/state/helpers/status-client.ts';
import { reportError } from '@/lib/sentry.ts';

export interface RunStatusProviderProps {
  readonly children: ReactNode;
}

/**
 * Loads what the last run reported and shares it with the tree below.
 *
 * Only ever provides a status whose promised retry is still ahead, so readers
 * need no clock of their own. Deliberately separate from the manifest's own
 * load: a status that cannot be read is reported and then treated as no
 * status at all, so nothing about it can delay or prevent showing the game.
 */
export function RunStatusProvider({ children }: RunStatusProviderProps) {
  const [status, setStatus] = useState<RunStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const loaded = await fetchRunStatus();
        if (cancelled) return;
        // A retry that already fell due is nothing left to report.
        setStatus(loaded !== null && !isRetryTimePast(loaded, Date.now()) ? loaded : null);
      } catch (error) {
        if (cancelled) return;
        reportError(error, { area: 'run-status' });
        setStatus(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Drops the status the moment its retry falls due, so a page left open
  // stops promising a game that has since become due.
  useEffect(() => {
    if (status === null) return;
    const timer = setTimeout(() => setStatus(null), Date.parse(status.retryAt) - Date.now());
    return () => clearTimeout(timer);
  }, [status]);

  return <RunStatusContext.Provider value={status}>{children}</RunStatusContext.Provider>;
}
