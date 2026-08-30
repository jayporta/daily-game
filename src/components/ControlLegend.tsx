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
      // `min-h-8` is the height of a rating pill opposite (`text-ui` plus
      // `py-1.5`), so the two centre on one line even though the `kbd` chips
      // here are shorter. A minimum rather than a fixed height: the strip
      // anchors both sides to its top, which is what keeps this beside the
      // game when the dislike panel opens and makes that side tall.
      className="flex min-h-8 flex-wrap items-center gap-4 text-legend text-label dark:text-slate-400"
    >
      {controls.map((control) => (
        <span key={controlIdentity(control)} className="flex items-center gap-1.5">
          <span>{control.action}</span>
          <kbd className="rounded-md border border-key-edge bg-key px-1.75 py-0.5 font-mono text-kbd text-body dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {control.key}
          </kbd>
        </span>
      ))}
    </div>
  );
}
