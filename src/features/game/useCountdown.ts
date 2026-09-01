import { useEffect, useState } from 'react';
import { formatCountdown, msUntil, msUntilLabelChanges } from '#src/features/game/countdown.ts';

/**
 * Live "time until this game is replaced" label.
 *
 * Reschedules itself on the label's own granularity rather than ticking once
 * a second: a minute apart while an hour or more remains, a second apart
 * below that, and not at all once it reads "any moment now". The label on
 * screen at any instant is the one a 1 Hz clock would be showing; the
 * wakeups that would have recomputed it unchanged are what goes away. One
 * survives per granularity change, where the first wait only aligns to the
 * boundary.
 *
 * Holds the formatted label, so React also bails out if a tick ever does
 * produce the same string.
 *
 * @param expiresAt ISO timestamp from the manifest.
 * @returns Formatted remaining time, e.g. `"6h 12m"` or `"any moment now"`.
 */
export function useCountdown(expiresAt: string): string {
  const [label, setLabel] = useState(() => formatCountdown(msUntil(expiresAt)));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = (): void => {
      const remaining = msUntil(expiresAt);
      setLabel(formatCountdown(remaining));
      const delay = msUntilLabelChanges(remaining);
      if (delay > 0) timer = setTimeout(tick, delay);
    };

    // Once immediately, so a new `expiresAt` applies before the first wait.
    tick();
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return label;
}
