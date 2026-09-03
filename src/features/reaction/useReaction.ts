import { useState } from 'react';
import type { DislikeReason, ReactionConfig, ReactionKind } from '#lib/reaction-types.ts';
import {
  buildInsertRequest,
  readReaction,
  rememberReaction,
  sendReaction,
} from '#src/features/reaction/reaction.ts';
import { localStorageOrNull } from '#src/lib/browser-storage.ts';

/**
 * Where the viewer is in rating today's game.
 *
 * `choosing` exists because a dislike is committed as a single insert
 * carrying its reasons — the store's key is insert-only, so there is no
 * second write to attach them with.
 */
export type ReactionPhase = 'idle' | 'choosing' | 'submitted';

/** The viewer's progress through rating one game, and how to advance it. */
export interface UseReactionResult {
  /** Where the viewer has got to; drives what {@link ReactionBar} renders. */
  readonly phase: ReactionPhase;
  /** Commits a like. A no-op unless the phase is `idle`. */
  like: () => void;
  /** Opens the reasons panel. A no-op unless the phase is `idle`. */
  beginDislike: () => void;
  /**
   * Closes the reasons panel without rating anything.
   *
   * Nothing has been committed at this point, so dismissing the panel has to
   * leave the viewer able to rate the game afterwards. A no-op unless the
   * phase is `choosing`.
   */
  cancelDislike: () => void;
  /** Commits a dislike with `reasons`. A no-op unless the phase is `choosing`. */
  submitDislike: (reasons: readonly DislikeReason[]) => void;
}

/** Which game is being rated, and where its row goes. */
export interface UseReactionParams {
  /** Manifest slug of the game being rated — the row's key in the store. */
  readonly slug: string;
  /**
   * Where to send the row. A `null` `endpointUrl` keeps everything local and
   * issues no request. See {@link buildInsertRequest}.
   */
  readonly config: ReactionConfig;
  /** Replaces global `fetch`; injected by tests. */
  readonly fetchImpl?: typeof fetch;
}

/** The slug a session belongs to, so it cannot outlive that game. */
interface Session {
  readonly slug: string;
  readonly phase: ReactionPhase;
}

/** Whether this visitor has already rated `slug`, read once per slug. */
function initialSession(slug: string): Session {
  return {
    slug,
    phase: readReaction(localStorageOrNull(), slug) === null ? 'idle' : 'submitted',
  };
}

/**
 * Tracks the like/dislike reaction for one day's game.
 *
 * Rating is one-way — the store counts inserts and cannot be decremented,
 * so there is no un-rating — and is scoped to `slug`, so nothing carries
 * over when tomorrow's game replaces today's, including when the manifest
 * is swapped in place without a remount.
 *
 * `localStorage` is read in the state initializer and, for a slug change,
 * during the render that notices it — never on every render. Rendering has to
 * be pure, and `localStorage` is an external mutable store: reading it each
 * pass would also re-parse the stored JSON for no one.
 */
export function useReaction({ slug, config, fetchImpl }: UseReactionParams): UseReactionResult {
  const [session, setSession] = useState<Session>(() => initialSession(slug));

  // The day rolled over without a remount. Adjusting state during render is
  // React's own supported pattern for deriving from a changed prop — it
  // restarts this render before any child sees the stale phase, which an
  // effect could not do.
  const current = session.slug === slug ? session : initialSession(slug);
  if (current !== session) setSession(current);

  const commit = (kind: ReactionKind, reasons: readonly DislikeReason[]): void => {
    setSession({ slug, phase: 'submitted' });
    rememberReaction({ storage: localStorageOrNull(), slug, reaction: { kind, reasons } });
    // Deliberately not awaited: the store is decoration, nothing on screen
    // waits for it, and `sendReaction` never rejects.
    void sendReaction(buildInsertRequest(config, { slug, reaction: kind, reasons }), { fetchImpl });
  };

  return {
    phase: current.phase,
    like: () => {
      if (current.phase !== 'idle') return;
      commit('like', []);
    },
    beginDislike: () => {
      if (current.phase !== 'idle') return;
      setSession({ slug, phase: 'choosing' });
    },
    cancelDislike: () => {
      if (current.phase !== 'choosing') return;
      setSession({ slug, phase: 'idle' });
    },
    submitDislike: (reasons) => {
      if (current.phase !== 'choosing') return;
      commit('dislike', reasons);
    },
  };
}
