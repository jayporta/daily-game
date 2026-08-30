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
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
      <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">{manifest.title}</h1>
      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        {manifest.genreLabel}
      </span>
      <span className="text-slate-500">
        Generated {formatGeneratedDate(manifest.generatedAt)}
      </span>
      <span className="text-slate-500">
        built by <code className="text-slate-600 dark:text-slate-400">{manifest.model}</code>
      </span>
      <span className="text-slate-500">
        replaced in <span className="tabular-nums text-slate-700 dark:text-slate-300">{countdown}</span>
      </span>
    </div>
  );
}
