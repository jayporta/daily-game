import type { ReactNode } from 'react';

export interface CenteredProps {
  /** Message to centre in the viewer area. */
  children: ReactNode;
}

/**
 * A status message where the game would be.
 *
 * Carries no layout of its own: the viewer area centres and pads its single
 * child, so this only has to set the text.
 */
export function Centered({ children }: CenteredProps) {
  return (
    <p className="max-w-sm text-center text-ui text-meta dark:text-slate-400">{children}</p>
  );
}
