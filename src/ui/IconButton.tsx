import type { ReactNode } from 'react';

/**
 * A circular icon control, either an action or a link.
 *
 * Modelled as a union so a caller cannot supply both, or neither: the two
 * halves render different elements and a link with an `onClick` would be a
 * button wearing an anchor's clothes.
 */
export type IconButtonProps = {
  /** Accessible name. The icon itself is hidden from assistive tech. */
  readonly label: string;
  /** The icon, sized by the caller. */
  readonly children: ReactNode;
} & ({ readonly href: string } | { readonly onClick: () => void });

const CIRCLE =
  'flex size-8.5 shrink-0 items-center justify-center rounded-full bg-chip text-label ' +
  'transition-colors hover:bg-slate-200 hover:text-body dark:bg-slate-800 dark:text-slate-400 ' +
  'dark:hover:bg-slate-700 dark:hover:text-slate-100';

/** The header's icon controls, so they stay one shape and one palette. */
export function IconButton(props: IconButtonProps) {
  if ('href' in props) {
    return (
      <a
        className={CIRCLE}
        href={props.href}
        aria-label={props.label}
        target="_blank"
        rel="noreferrer noopener"
      >
        {props.children}
      </a>
    );
  }
  return (
    <button type="button" className={CIRCLE} onClick={props.onClick} aria-label={props.label}>
      {props.children}
    </button>
  );
}
