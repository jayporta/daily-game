import { DislikeReasons } from './DislikeReasons.tsx';
import { useReaction } from '../hooks/useReaction.ts';
import { reactionConfig } from '../lib/reaction-config.ts';
import type { ReactionConfig } from '../lib/reaction.ts';

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
      {phase === 'submitted' && (
        <p className="min-h-8 content-center text-meta dark:text-slate-400">
          Thanks — that helps tomorrow&rsquo;s game.
        </p>
      )}

      {phase === 'idle' && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={beginDislike}
            className="rounded-2xl bg-chip px-4 py-1.5 font-semibold text-label transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Dislike
          </button>
          <button
            type="button"
            onClick={like}
            className="rounded-2xl bg-like px-4 py-1.5 font-semibold text-like-ink transition-colors hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
          >
            Like
          </button>
        </div>
      )}

      {phase === 'choosing' && <DislikeReasons onSubmit={submitDislike} />}
    </div>
  );
}
