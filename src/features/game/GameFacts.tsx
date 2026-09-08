// When the game was made, by what, and how long it has left — or, when the
// provider has nothing left to give, why no new one is coming. The model id
// is AI-adjacent content and renders as escaped JSX like everything else.

import { useManifestContext } from '@/features/game/state/context/useManifestContext.ts';
import { useRunStatusContext } from '@/features/game/state/context/useRunStatusContext.ts';
import { formatGeneratedDate } from '@/features/game/state/helpers/countdown.ts';
import { isNewerThanGame } from '@/features/game/state/helpers/status-client.ts';
import { useCountdown } from '@/features/game/state/useCountdown.ts';
import { CodeChip } from '@/shared_components/CodeChip.tsx';
import { ErrorText } from '@/shared_components/ErrorText.tsx';
import { MetaText } from '@/shared_components/MetaText.tsx';

/** Provenance and the live countdown, on one line beneath the title. */
export function GameFacts() {
  const manifest = useManifestContext();
  const runStatus = useRunStatusContext();
  const countdown = useCountdown(manifest.expiresAt);

  // Counting down to a game the provider cannot produce would be a promise
  // the site knows it will not keep. The provider has already dropped a status
  // whose retry fell due, so only the game on screen is left to check against.
  const outOfQuota = runStatus !== null && isNewerThanGame(runStatus, manifest.date);

  return (
    <MetaText layout="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span>Generated {formatGeneratedDate(manifest.generatedAt)} by</span>
      <CodeChip>{manifest.model}</CodeChip>
      <span aria-hidden="true">&middot;</span>
      {outOfQuota ? (
        <ErrorText announce="status">OpenRouter quota exceeded. Will try again tomorrow.</ErrorText>
      ) : (
        <span>
          expires in{' '}
          <span className="font-bold tabular-nums text-body dark:text-slate-200">{countdown}</span>
        </span>
      )}
    </MetaText>
  );
}
