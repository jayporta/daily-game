// When the game was made, by what, and how long it has left. The model id
// is AI-adjacent content and renders as escaped JSX like everything else.
import { CodeChip } from '../../ui/CodeChip.tsx';
import { formatGeneratedDate } from './countdown.ts';
import { useCountdown } from './useCountdown.ts';
import type { Manifest } from '../../../lib/manifest.ts';

export interface GameFactsProps {
  /** The current day's manifest, as written by the publish step. */
  manifest: Manifest;
}

/** Provenance and the live countdown, on one line beneath the title. */
export function GameFacts({ manifest }: GameFactsProps) {
  const countdown = useCountdown(manifest.expiresAt);

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ui text-meta dark:text-slate-400">
      <span>Generated {formatGeneratedDate(manifest.generatedAt)} by</span>
      <CodeChip>{manifest.model}</CodeChip>
      <span aria-hidden="true">&middot;</span>
      <span>
        expires in{' '}
        <span className="font-bold tabular-nums text-body dark:text-slate-200">{countdown}</span>
      </span>
    </p>
  );
}
