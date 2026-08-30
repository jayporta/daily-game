// Metadata strip: what the game is, which model built it, and how long
// it has left. Every field here comes from AI-generated content, so it is
// rendered as JSX text — never innerHTML — and React escapes it.
import { formatGeneratedDate } from '../lib/countdown.ts';
import { useCountdown } from '../hooks/useCountdown.ts';
import type { Manifest } from '../../lib/types.ts';

export interface GameMetaProps {
  /** The current day's manifest, as written by the publish step. */
  manifest: Manifest;
}

/** Title, genre, model and live countdown for the current game. */
export function GameMeta({ manifest }: GameMetaProps) {
  const countdown = useCountdown(manifest.expiresAt);

  return (
    <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2.5 text-ui text-meta dark:text-slate-400">
      <h1 className="font-display text-xl font-bold text-title dark:text-slate-100">
        {manifest.title}
      </h1>
      <span className="rounded-lg bg-like px-2.75 py-0.75 text-xs font-semibold text-like-ink dark:bg-emerald-500/15 dark:text-emerald-300">
        {manifest.genreLabel}
      </span>
      <span>Generated {formatGeneratedDate(manifest.generatedAt)}</span>
      <span>
        built by{' '}
        <code className="rounded-sm bg-chip px-1.25 py-px font-mono text-code text-label dark:bg-slate-800 dark:text-slate-300">
          {manifest.model}
        </code>
      </span>
      <span>
        will be replaced in{' '}
        <span className="font-bold tabular-nums text-body dark:text-slate-200">{countdown}</span>
      </span>
    </div>
  );
}
