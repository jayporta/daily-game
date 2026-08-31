// The page body once the day's game has loaded: the frame, the metadata card
// beneath it, and the BYOK panel below that.
//
// Beside App.tsx rather than under a feature because it is the composition of
// three — game, reaction and byok — and belongs to none of them.
import { Panel } from './ui/Panel.tsx';
import { PillButton } from './ui/PillButton.tsx';
import { ControlLegend } from './features/game/ControlLegend.tsx';
import { GameFacts } from './features/game/GameFacts.tsx';
import { GameFrame } from './features/game/GameFrame.tsx';
import { GameTitle } from './features/game/GameTitle.tsx';
import { ReactionBar } from './features/reaction/ReactionBar.tsx';
import { ByokFacts } from './features/byok/ByokFacts.tsx';
import { ByokPanel, type ByokResult } from './features/byok/ByokPanel.tsx';
import { SYSTEM_PROMPT } from '../lib/system-prompt.ts';
import type { Manifest } from '../lib/manifest.ts';

export interface GameViewProps {
  readonly manifest: Manifest;
  readonly html: string;
  /** A visitor's own generation, shown in place of the day's game. */
  readonly byokOverride: ByokResult | null;
  readonly onByokResult: (result: ByokResult) => void;
  readonly onDismissByok: () => void;
}

/**
 * The day's game, or the visitor's own regeneration of it.
 *
 * Which of the two is showing is decided once, in `shown` — every field the
 * frame and the card need comes from there, so the two cannot disagree about
 * which game is on screen. Only the provenance line and the dismiss button
 * branch again, because they exist for one case and not the other.
 */
export function GameView({
  manifest,
  html,
  byokOverride,
  onByokResult,
  onDismissByok,
}: GameViewProps) {
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
      <GameFrame html={shown.html} title={shown.title} />

      <Panel>
        {/* `items-start` so a wrapped title does not drag the rating
            controls down with it. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <GameTitle title={shown.title} genreLabel={shown.genreLabel} />
          {byokOverride === null && <ReactionBar slug={manifest.slug} />}
        </div>

        <div className="mt-1">
          {byokOverride === null ? (
            <GameFacts manifest={manifest} />
          ) : (
            <ByokFacts
              providerLabel={byokOverride.providerLabel}
              modelId={byokOverride.modelId}
            />
          )}
        </div>

        <div className="mt-4">
          <ControlLegend controls={shown.controls} />
        </div>

        {byokOverride !== null && (
          <div className="mt-4">
            <PillButton tone="neutral" onClick={onDismissByok}>
              Back to today&rsquo;s game
            </PillButton>
          </div>
        )}
      </Panel>

      {/* The panel re-runs the day's exact prompt, so a game archived before
          prompts were has nothing for it to send. */}
      {manifest.promptPath !== undefined && (
        <ByokPanel
          systemPrompt={SYSTEM_PROMPT}
          promptPath={manifest.promptPath}
          onResult={onByokResult}
        />
      )}
    </>
  );
}
