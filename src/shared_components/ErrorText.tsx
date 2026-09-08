import type { ReactNode } from 'react';

/**
 * Red in both palettes.
 *
 * A complete class string rather than fragments, since Tailwind only
 * generates the class names it can read whole in the source.
 */
const ERROR = 'text-rose-600 dark:text-rose-400';

export interface ErrorTextProps {
  /** What went wrong, in words a visitor can act on. */
  readonly children: ReactNode;
  /**
   * Layout utilities only — margin, display, alignment. Colour belongs to
   * this component: a second `text-*` colour here would put two `color`
   * utilities on one element, where Tailwind silently drops one.
   */
  readonly layout?: string;
  /**
   * How assistive tech announces it. `alert` interrupts, which suits
   * something the visitor just did; `status` waits its turn, which suits
   * something that arrived on its own.
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
