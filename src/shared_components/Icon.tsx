import type { ReactNode } from 'react';

export interface IconProps {
  /**
   * The shapes, on a 24x24 grid — `<path>`, `<circle>` and the like. They
   * inherit the stroke and cap settings from the `<svg>` this draws, so a
   * shape carries geometry only.
   */
  readonly children: ReactNode;
}

/**
 * The stroked line icon every control in the chrome is drawn as.
 *
 * Owns the whole attribute set rather than leaving it to each caller: the
 * three icons that spelled it out separately had already drifted, one of them
 * losing `strokeLinejoin` and so mitring the corners its neighbours rounded.
 *
 * Hidden from assistive tech, because the control around it carries the
 * accessible name.
 */
export function Icon({ children }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4.5"
    >
      {children}
    </svg>
  );
}
