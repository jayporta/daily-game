import { DislikeReasons } from './DislikeReasons.tsx';
import { PillButton } from '../../ui/PillButton.tsx';
import { useReaction } from './useReaction.ts';
import { reactionConfig } from './reactionStore.ts';
import type { ReactionConfig } from '../../../lib/reaction-types.ts';

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
  const { phase, like, beginDislike, submitDislike } = useReaction(slug, config, fetchImpl);

  return (
    <div role="group" aria-label="Rate this game" className="ml-auto text-ui">
      {/* The buttons that had focus are gone by the time this renders, so a
          screen reader is told rather than left to discover it. */}
      {phase === 'submitted' && (
        <p aria-live="polite" className="min-h-8 content-center text-meta dark:text-slate-400">
          Thanks — that helps tomorrow&rsquo;s game.
        </p>
      )}

      {phase === 'idle' && (
        <div className="flex items-center gap-2">
          <PillButton tone="neutral" onClick={beginDislike}>
            Dislike
          </PillButton>
          <PillButton tone="accent" onClick={like}>
            Like
          </PillButton>
        </div>
      )}

      {phase === 'choosing' && <DislikeReasons onSubmit={submitDislike} />}
    </div>
  );
}
