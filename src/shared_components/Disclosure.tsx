import type { ReactNode } from 'react';

export interface DisclosureProps {
  /** The always-visible summary line, beside its triangle. */
  readonly summary: string;
  /**
   * Called when the disclosure is opened or closed.
   *
   * Fires on both, since `toggle` does not distinguish; a caller that only
   * cares about opening can start work idempotently and ignore the rest.
   */
  readonly onToggle?: () => void;
  readonly children: ReactNode;
}

/**
 * The collapsed detail rows under the BYOK panel — the prompt that will be
 * sent, and the code that came back.
 *
 * Extracted rather than written twice: the two rows carry the same triangle,
 * the same summary type and the same body inset, and a class string that
 * appears in two places has already drifted once.
 */
export function Disclosure({ summary, onToggle, children }: DisclosureProps) {
  return (
    <details className="group mt-2" onToggle={onToggle}>
      <summary className="cursor-pointer text-meta dark:text-slate-400">{summary}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
