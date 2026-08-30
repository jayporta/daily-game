import { controlIdentity } from '../../lib/extract-bundle-shared.ts';
import type { ControlHint } from '../../lib/types.ts';

export interface ControlLegendProps {
  /** What the game reported it listens for, in the order it gave. */
  readonly controls: readonly ControlHint[];
}

/**
 * How to play the current game.
 *
 * The control scheme is the game's own invention — the prompt asks it to
 * report what it built rather than prescribing a mapping — so both halves
 * are model-authored text and render as escaped JSX, never markup.
 *
 * Renders nothing at all for a game that reported no controls, which is
 * normal: several genres here are mouse-driven.
 */
export function ControlLegend({ controls }: ControlLegendProps) {
  if (controls.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Controls"
      // `min-h-7` is the height of a rating button opposite (`text-sm` plus
      // `py-1`), so the two centre on one line even though the `kbd` chips
      // here are shorter. A minimum rather than a fixed height: the strip
      // anchors both sides to its top, which is what keeps this beside the
      // game when the dislike panel opens and makes that side tall.
      className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400"
    >
      {controls.map((control) => (
        <span key={controlIdentity(control)} className="flex items-center gap-1.5">
          <span>{control.action}</span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-sans text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {control.key}
          </kbd>
        </span>
      ))}
    </div>
  );
}
