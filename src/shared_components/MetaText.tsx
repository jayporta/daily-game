import type { ReactNode } from 'react';

/**
 * Quieter than the body text, in both palettes.
 *
 * A complete class string rather than fragments, since Tailwind only
 * generates the class names it can read whole in the source.
 */
const META = 'text-ui text-meta dark:text-slate-400';

export interface MetaTextProps {
  /** The line's content. */
  readonly children: ReactNode;
  /**
   * Layout utilities only — margin, alignment, flex. Size and colour belong
   * to this component: a second `text-*` colour here would put two `color`
   * utilities on one element, where Tailwind silently drops one.
   */
  readonly layout?: string;
}

/**
 * The secondary line the page explains itself in: the tagline in the header,
 * a game's provenance, a status message where the game would be.
 *
 * Renders a `<p>`, which Tailwind's preflight strips of its default margins,
 * so it sits inside a flex row exactly as a `<span>` would.
 */
export function MetaText({ children, layout }: MetaTextProps) {
  return <p className={layout === undefined ? META : `${META} ${layout}`}>{children}</p>;
}
