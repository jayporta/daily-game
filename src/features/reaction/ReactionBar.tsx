import { useEffect, useRef } from 'react';
import { DislikeReasons } from '@/features/reaction/DislikeReasons.tsx';
import { PillButton } from '@/shared_components/PillButton.tsx';
import { useReaction } from '@/features/reaction/useReaction.ts';
import { reactionConfig } from '@/features/reaction/reactionStore.ts';
import type { ReactionConfig } from '#lib/reaction-types.ts';

export interface ReactionBarProps {
  /** Manifest slug of the game being rated — the row's key in the store. */
  readonly slug: string;
  /** Overridden in tests; defaults to the config this site shipped with. */
  readonly config?: ReactionConfig;
  /** Replaces global `fetch`; injected by tests. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Like / dislike for the current game, with a fixed set of reasons behind
 * dislike.
 *
 * Renders in the parent page, beneath the game — never inside the frame.
 * The frame holds AI-authored code under an opaque origin so it can reach
 * nothing of ours, and the controls a visitor uses to judge a game must not
 * be reachable by the code they are judging. Putting them inside would also
 * mean writing into a published bundle, which must ship byte-for-byte.
 *
 * Shows no totals: the browser writes to the store and never reads from it,
 * which is what keeps store content out of this page entirely.
 */
export function ReactionBar({ slug, config = reactionConfig, fetchImpl }: ReactionBarProps) {
  const { phase, like, beginDislike, cancelDislike, submitDislike } = useReaction({
    slug,
    config,
    fetchImpl,
  });
  const bar = useRef<HTMLDivElement>(null);

  // Dismissal for the reasons panel, which nothing in React models: a
  // dropdown whose only exit committed a rating would trap a viewer who
  // opened it by accident.
  useEffect(() => {
    if (phase !== 'choosing') return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelDislike();
    };
    // `pointerdown`, not `click`: a press that starts outside should dismiss
    // even if the pointer is released somewhere else.
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      const inside = target instanceof Node && bar.current?.contains(target) === true;
      if (!inside) cancelDislike();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, cancelDislike]);

  return (
    <div ref={bar} role="group" aria-label="Rate this game" className="relative ml-auto text-ui">
      {/* The buttons that had focus are gone by the time this renders, so a
          screen reader is told rather than left to discover it. */}
      {phase === 'submitted' && (
        <p aria-live="polite" className="min-h-8 content-center text-meta dark:text-slate-400">
          Feedback sent
        </p>
      )}

      {phase !== 'submitted' && (
        <div className="flex items-center gap-2">
          <PillButton tone="neutral" onClick={beginDislike}>
            Dislike
          </PillButton>
          <PillButton tone="accent" onClick={like}>
            Like
          </PillButton>
        </div>
      )}

      {phase === 'choosing' && (
        // Hung below the buttons rather than placed in the flow, so opening
        // it does not push the metadata card and the panel below it down.
        // It paints its own background deliberately: it overlaps content it
        // would otherwise be read through.
        //
        // Narrow first, then wider from `sm:`. Anchored to `right-0`, so its
        // width is spent leftwards: at 320px the roomier size would put its
        // left edge past the edge of the screen, where `max-w-full` cannot
        // help — the containing block is this bar, not the content column.
        <div className="absolute top-full right-0 z-20 mt-2 w-56 rounded-xl border border-hairline bg-panel p-3 text-left shadow-lg sm:w-72 dark:border-slate-800 dark:bg-slate-900">
          <DislikeReasons onSubmit={submitDislike} />
        </div>
      )}
    </div>
  );
}
