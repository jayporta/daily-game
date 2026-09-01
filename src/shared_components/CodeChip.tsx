import type { ReactNode } from 'react';

export interface CodeChipProps {
  /** The literal text — a command to type, or a model identifier. */
  readonly children: ReactNode;
}

/**
 * Something the viewer should read as literal input or an identifier.
 *
 * Carries no margin; the surrounding sentence owns its spacing.
 */
export function CodeChip({ children }: CodeChipProps) {
  return (
    <code className="rounded-sm bg-chip px-1.25 py-px font-mono text-code text-label dark:bg-slate-800 dark:text-slate-300">
      {children}
    </code>
  );
}
