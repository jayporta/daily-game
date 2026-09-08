// When the game was made, by what, and how long it has left. The model id
// is AI-adjacent content and renders as escaped JSX like everything else.

import { useManifestContext } from '@/features/game/state/context/useManifestContext.ts';
import { formatGeneratedDate } from '@/features/game/state/helpers/countdown.ts';
import { useCountdown } from '@/features/game/state/useCountdown.ts';
import { CodeChip } from '@/shared_components/CodeChip.tsx';
import { MetaText } from '@/shared_components/MetaText.tsx';

/** Provenance and the live countdown, on one line beneath the title. */
export function GameFacts() {
  const manifest = useManifestContext();
  const countdown = useCountdown(manifest.expiresAt);

  return (
    <MetaText layout="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span>Generated {formatGeneratedDate(manifest.generatedAt)} by</span>
      <CodeChip>{manifest.model}</CodeChip>
      <span aria-hidden="true">&middot;</span>
      <span>
        expires in{' '}
        <span className="font-bold tabular-nums text-body dark:text-slate-200">{countdown}</span>
      </span>
    </MetaText>
  );
}
