import { useEffect, useMemo, useRef } from 'react';
import { useByokStatus } from '@/features/byok/state/context/useByokStatus.ts';
import { lastLines } from '@/features/byok/state/helpers/lastLines.ts';
import { GameBox } from '@/features/game/GameBox.tsx';

/**
 * How much of the tail is painted.
 *
 * The console is a progress indicator, not a code reader — the full document
 * is browsable afterwards. Painting only the end keeps a long generation from
 * growing the DOM without bound, and keeps every repaint the same cost
 * whether the model is 200 characters in or 30,000.
 */
const VISIBLE_LINES = 120;

/**
 * The model's output as it arrives, in place of the game.
 *
 * Occupies exactly the frame's box, so the game can take over the same space
 * without the page shifting under the visitor.
 */
export function GenerationConsole() {
  const status = useByokStatus();
  const scroller = useRef<HTMLDivElement>(null);
  // Idle is unreachable while this is mounted: GameView renders the frame
  // instead. Read defensively anyway so the component has no impossible case.
  const output = status.status === 'idle' ? '' : status.output;
  const providerLabel = status.status === 'idle' ? '' : status.run.providerLabel;
  const failure = status.status === 'error' ? status.message : null;
  const tail = useMemo(() => lastLines(output, VISIBLE_LINES), [output]);

  // Synchronising with the element's own scroll position, which React does
  // not model. Runs after every published fragment so the newest line stays
  // in view the way a terminal's does.
  useEffect(() => {
    const element = scroller.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [tail, failure]);

  return (
    <GameBox ground="console">
      {/* One announcement per edge of the run, in place of the output's own.
          A polite region repainted on every streamed fragment queues an
          utterance per frame, which a screen reader then reads long after
          the run has finished. */}
      <p className="sr-only" role="status">
        {failure === null ? `Generating with ${providerLabel}…` : `Generation failed: ${failure}`}
      </p>

      {/* A named section rather than a log. `role="log"` carries live
          semantics of its own, and suppressing those with aria-live="off" is
          spec-valid but honoured unevenly — so nothing here claims a role
          that announces, and aria-live says so a second time. */}
      <section
        ref={scroller}
        aria-label="Generation output"
        aria-live="off"
        className="h-full overflow-auto p-4 font-mono text-xs leading-5 text-slate-300"
      >
        {status.status !== 'idle' && (
          <>
            <p className="text-emerald-400">{`● connecting to ${providerLabel}…`}</p>
            <p className="text-emerald-400">{`● model ${status.run.modelId}`}</p>
          </>
        )}

        {/* The model's own text. Rendered as a string inside JSX, so React
            escapes it — this is AI-authored markup and nothing here may
            interpret it. Only the sandboxed frame ever runs it. */}
        <pre className="mt-2 whitespace-pre-wrap">{tail}</pre>

        {failure === null ? (
          <span className="inline-block animate-pulse text-emerald-400">▊</span>
        ) : (
          <p className="mt-2 text-rose-400">{`● failed: ${failure}`}</p>
        )}
      </section>
    </GameBox>
  );
}
