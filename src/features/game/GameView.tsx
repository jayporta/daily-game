// The page body once the day's game has loaded: the frame, the metadata card
// beneath it, and the BYOK panel below that.
//
// Beside App.tsx rather than under a feature because it is the composition of
// three — game, reaction and byok — and belongs to none of them.

import { ByokFacts } from '@/features/byok/ByokFacts.tsx';
import { ByokPanel } from '@/features/byok/ByokPanel.tsx';
import { GeneratedCode } from '@/features/byok/GeneratedCode.tsx';
import { GenerationConsole } from '@/features/byok/GenerationConsole.tsx';
import { useByokActions } from '@/features/byok/state/context/useByokActions.ts';
import { useByokStatus } from '@/features/byok/state/context/useByokStatus.ts';
import { ControlLegend } from '@/features/game/ControlLegend.tsx';
import { GameFacts } from '@/features/game/GameFacts.tsx';
import { GameFrame } from '@/features/game/GameFrame.tsx';
import { GameTitle } from '@/features/game/GameTitle.tsx';
import { useManifestContext } from '@/features/game/state/context/useManifestContext.ts';
import { ReactionBar } from '@/features/reaction/ReactionBar.tsx';
import { Panel } from '@/shared_components/Panel.tsx';
import { PillButton } from '@/shared_components/PillButton.tsx';

export interface GameViewProps {
  readonly html: string;
}

/**
 * The day's game, or the visitor's own regeneration of it.
 *
 * Which of the two is showing is decided once, in `shown` — every field the
 * frame and the card need comes from there, so the two cannot disagree about
 * which game is on screen. Only the provenance line and the dismiss button
 * branch again, because they exist for one case and not the other.
 */
export function GameView({ html }: GameViewProps) {
  const manifest = useManifestContext();
  const status = useByokStatus();
  const { override: byokOverride, backToTodaysGame } = useByokActions();
  const shown =
    byokOverride === null
      ? {
          html,
          title: manifest.title,
          genreLabel: manifest.genreLabel,
          controls: manifest.controls,
        }
      : {
          html: byokOverride.html,
          title: byokOverride.title,
          genreLabel: null,
          controls: byokOverride.controls,
        };

  return (
    <>
      {/* One box, two occupants: while a visitor's own generation runs, its
          output stands where the game will appear, so nothing on the page
          moves when the game takes over. */}
      {/* Empty until a visitor's own generation takes the frame, so it says
          nothing on an ordinary page load and announces once when one
          arrives. The console it replaces has gone by then. */}
      <p className="sr-only" role="status">
        {byokOverride === null ? '' : `Your game is ready: ${byokOverride.title}`}
      </p>

      {status.status === 'idle' ? (
        <GameFrame html={shown.html} title={shown.title} />
      ) : (
        <GenerationConsole />
      )}

      {status.status === 'error' && (
        <div className="mt-3">
          <PillButton tone="neutral" onClick={backToTodaysGame}>
            Back to today&rsquo;s game
          </PillButton>
        </div>
      )}

      <Panel>
        {/* `items-start` so a wrapped title does not drag the rating
            controls down with it. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <GameTitle title={shown.title} genreLabel={shown.genreLabel} />
          {byokOverride === null && <ReactionBar slug={manifest.slug} />}
        </div>

        <div className="mt-1">
          {byokOverride === null ? (
            <GameFacts />
          ) : (
            <ByokFacts providerLabel={byokOverride.providerLabel} modelId={byokOverride.modelId} />
          )}
        </div>

        <div className="mt-4">
          <ControlLegend controls={shown.controls} />
        </div>

        {/* `shown.html`, not the override: the viewer and the frame read the
            one value, so the code on display is always the code running. */}
        <GeneratedCode html={shown.html} title={shown.title} />

        {byokOverride !== null && status.status !== 'error' && (
          <div className="mt-4">
            <PillButton tone="neutral" onClick={backToTodaysGame}>
              Back to today&rsquo;s game
            </PillButton>
          </div>
        )}
      </Panel>

      {/* The panel re-runs the day's exact prompt, so a game archived before
          prompts were has nothing for it to send. */}
      {manifest.promptPath !== undefined && (
        <ByokPanel promptPath={manifest.promptPath} currentGameHtml={shown.html} />
      )}
    </>
  );
}
