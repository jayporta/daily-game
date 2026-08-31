import type { ReactNode } from 'react';

export interface PanelProps {
  /** What sits inside the card. */
  readonly children: ReactNode;
}

/**
 * The raised card the page's content sits on, beneath the game frame.
 *
 * Owns its own top margin: every panel on this page follows something, and
 * the stack reads as one rhythm only if the gap is decided in one place.
 */
export function Panel({ children }: PanelProps) {
  return (
    <div className="mt-3 rounded-xl border border-hairline bg-panel px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
      {children}
    </div>
  );
}
