import type { ReactNode } from 'react';

export interface CenteredProps {
  /** Message to centre in the viewer area. */
  children: ReactNode;
}

/** Fills the viewer area with a centred status message. */
export function Centered({ children }: CenteredProps) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-slate-500 dark:text-slate-400">
      {children}
    </div>
  );
}
