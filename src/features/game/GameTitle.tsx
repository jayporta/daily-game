// The game's name and genre. Both come from AI-generated content, so they
// render as JSX text — never innerHTML — and React escapes them.
import type { Manifest } from '../../../lib/manifest.ts';

export interface GameTitleProps {
  /** The current day's manifest, as written by the publish step. */
  manifest: Manifest;
}

/** Title and genre badge, sitting opposite the rating controls. */
export function GameTitle({ manifest }: GameTitleProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h1 className="font-display text-2xl font-bold text-title dark:text-slate-100">
        {manifest.title}
      </h1>
      <span className="rounded-lg bg-like px-2.75 py-0.75 text-xs font-semibold text-like-ink dark:bg-emerald-500/15 dark:text-emerald-300">
        {manifest.genreLabel}
      </span>
    </div>
  );
}
