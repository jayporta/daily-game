// The game's name and genre. Both come from AI-generated content, so they
// render as JSX text — never innerHTML — and React escapes them.

export interface GameTitleProps {
  /** The game's name, as the model chose it. */
  readonly title: string;
  /**
   * The genre's readable name, or `null` to show no badge — which is what a
   * BYOK regeneration does, since it is not filed under the day's genre.
   */
  readonly genreLabel: string | null;
}

/** Title and genre badge, sitting opposite the rating controls. */
export function GameTitle({ title, genreLabel }: GameTitleProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h1 className="font-display text-2xl font-bold text-title dark:text-slate-100">{title}</h1>
      {genreLabel !== null && (
        <span className="rounded-lg bg-like px-2.75 py-0.75 text-xs font-semibold text-like-ink dark:bg-emerald-500/15 dark:text-emerald-300">
          {genreLabel}
        </span>
      )}
    </div>
  );
}
