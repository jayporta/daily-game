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
 * normal: several genres here are mouse-driven. The heading lives inside
 * this component so it disappears with them.
 */
export function ControlLegend({ controls }: ControlLegendProps) {
  if (controls.length === 0) return null;

  return (
    // Named by its own visible heading rather than an aria-label, so screen
    // readers do not announce the word twice.
    <section role="group" aria-labelledby="controls-heading">
      <h2
        id="controls-heading"
        className="text-legend font-semibold text-meta dark:text-slate-400"
      >
        Controls
      </h2>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-legend text-label dark:text-slate-400">
        {controls.map((control) => (
          <span key={controlIdentity(control)} className="flex items-center gap-1.5">
            <span>{control.action}</span>
            <kbd className="rounded-md border border-key-edge bg-key px-1.75 py-0.5 font-mono text-kbd text-body dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {control.key}
            </kbd>
          </span>
        ))}
      </div>
    </section>
  );
}
