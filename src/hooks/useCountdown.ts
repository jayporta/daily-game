import { useEffect, useState } from 'react';
import { formatCountdown, msUntil } from '../lib/countdown.ts';

/**
 * Live "time until this game is replaced" label, re-rendering once a second.
 *
 * @param expiresAt ISO timestamp from the manifest.
 * @returns Formatted remaining time, e.g. `"6h 12m"` or `"any moment now"`.
 */
export function useCountdown(expiresAt: string): string {
  const [remaining, setRemaining] = useState(() => msUntil(expiresAt));

  useEffect(() => {
    setRemaining(msUntil(expiresAt));
    const id = setInterval(() => setRemaining(msUntil(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return formatCountdown(remaining);
}
