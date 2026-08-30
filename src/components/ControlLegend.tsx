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
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 px-4 py-2 text-xs text-slate-400"
    >
      {controls.map((control) => (
        <span key={controlIdentity(control)} className="flex items-center gap-1.5">
          <span>{control.action}</span>
          <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-sans text-slate-300">
            {control.key}
          </kbd>
        </span>
      ))}
    </div>
  );
}
