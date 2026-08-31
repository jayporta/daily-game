import { useEffect, useMemo, useRef } from 'react';

export interface GenerationConsoleProps {
  /** Readable provider name, for the opening line. */
  readonly providerLabel: string;
  /** The model the visitor picked, for the line under it. */
  readonly modelId: string;
  /** The model's raw output so far. */
  readonly output: string;
  /** Why the run stopped, or `null` while it is still going. */
  readonly failure: string | null;
}

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
export function GenerationConsole({
  providerLabel,
  modelId,
  output,
  failure,
}: GenerationConsoleProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const tail = useMemo(() => lastLines(output, VISIBLE_LINES), [output]);

  // Synchronising with the element's own scroll position, which React does
  // not model. Runs after every published fragment so the newest line stays
  // in view the way a terminal's does.
  useEffect(() => {
    const element = scroller.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [tail, failure]);

  return (
    <div className="aspect-game w-full overflow-hidden rounded-xl bg-slate-950 shadow-frame">
      <div
        ref={scroller}
        role="log"
        aria-label="Generation output"
        aria-live="polite"
        className="h-full overflow-auto p-4 font-mono text-xs leading-5 text-slate-300"
      >
        <p className="text-emerald-400">{`● connecting to ${providerLabel}…`}</p>
        <p className="text-emerald-400">{`● model ${modelId}`}</p>

        {/* The model's own text. Rendered as a string inside JSX, so React
            escapes it — this is AI-authored markup and nothing here may
            interpret it. Only the sandboxed frame ever runs it. */}
        <pre className="mt-2 whitespace-pre-wrap">{tail}</pre>

        {failure === null ? (
          <span className="inline-block animate-pulse text-emerald-400">▊</span>
        ) : (
          <p className="mt-2 text-rose-400">{`● failed: ${failure}`}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The last `limit` lines of `text`.
 *
 * @returns The whole string when it is shorter than the limit, so a short
 *   run reads from its first line rather than being anchored to the bottom.
 */
function lastLines(text: string, limit: number): string {
  const lines = text.split('\n');
  return lines.length <= limit ? text : lines.slice(-limit).join('\n');
}
