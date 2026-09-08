import type { ReactNode } from 'react';

// Red in both palettes, written whole because Tailwind only generates the
// class names it can read whole in the source.
const ERROR = 'text-rose-600 dark:text-rose-400';

export interface ErrorTextProps {
  /** What went wrong, in words a visitor can act on. */
  readonly children: ReactNode;
  /**
   * Margin, display and alignment utilities.
   *
   * @remarks
   * Layout only. A `text-*` colour passed here would put two `color` utilities
   * on one element, and Tailwind silently drops one of them.
   */
  readonly layout?: string;
  /**
   * How assistive tech announces it: `alert` interrupts, `status` waits its
   * turn.
   *
   * @defaultValue `'alert'`, which suits something the visitor just caused.
   */
  readonly announce?: 'alert' | 'status';
}

/**
 * Something that went wrong, announced as it appears.
 *
 * Renders a `<span>`, so it is valid inside a line of text as well as on its
 * own; pass `block` through `layout` to stand it on its own line.
 */
export function ErrorText({ children, layout, announce = 'alert' }: ErrorTextProps) {
  return (
    <span role={announce} className={layout === undefined ? ERROR : `${ERROR} ${layout}`}>
      {children}
    </span>
  );
}
