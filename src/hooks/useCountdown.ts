import { useEffect, useState } from 'react';
import { formatCountdown, msUntil } from '../lib/countdown.ts';

/**
 * Live "time until this game is replaced" label.
 *
 * Holds the formatted label, so React bails out when a tick produces the
 * same string. The clock is still read every second, which the final minute
 * needs.
 *
 * @param expiresAt ISO timestamp from the manifest.
 * @returns Formatted remaining time, e.g. `"6h 12m"` or `"any moment now"`.
 */
export function useCountdown(expiresAt: string): string {
  const [label, setLabel] = useState(() => formatCountdown(msUntil(expiresAt)));

  useEffect(() => {
    const update = (): void => setLabel(formatCountdown(msUntil(expiresAt)));
    // Once immediately, so a new `expiresAt` applies before the first tick.
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return label;
}
