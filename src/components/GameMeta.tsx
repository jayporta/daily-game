// Metadata strip: what the game is, which model built it, and how long
// it has left. Every field here comes from AI-generated content, so it is
// rendered as JSX text — never innerHTML — and React escapes it.
import { useEffect, useState } from 'react';
import { formatCountdown, formatGeneratedDate, msUntil } from '../lib/countdown.ts';
import type { Manifest } from '../../lib/types.ts';

/**
 * Ticks once a second and returns the formatted time remaining.
 *
 * @param expiresAt ISO timestamp from the manifest.
 */
function useCountdown(expiresAt: string): string {
  const [remaining, setRemaining] = useState(() => msUntil(expiresAt));

  useEffect(() => {
    setRemaining(msUntil(expiresAt));
    const id = setInterval(() => setRemaining(msUntil(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return formatCountdown(remaining);
}

/** Title, genre, model and live countdown for the current game. */
export function GameMeta({ manifest }: { manifest: Manifest }) {
  const countdown = useCountdown(manifest.expiresAt);

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-400">
      <h1 className="text-base font-semibold text-slate-100">{manifest.title}</h1>
      <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
        {manifest.genre}
      </span>
      <span className="text-slate-500">
        Generated {formatGeneratedDate(manifest.generatedAt)}
      </span>
      <span className="text-slate-500">
        built by <code className="text-slate-400">{manifest.model}</code>
      </span>
      <span className="text-slate-500">
        replaced in <span className="tabular-nums text-slate-300">{countdown}</span>
      </span>
    </div>
  );
}
