import { useState } from 'react';
import {
  buildInsertRequest,
  readReaction,
  rememberReaction,
  sendReaction,
} from './reaction.ts';
import { localStorageOrNull } from '../../lib/browser-storage.ts';
import type {
  DislikeReason,
  ReactionConfig,
  ReactionKind,
} from '../../../lib/reaction-types.ts';

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
  /** Commits a dislike with `reasons`. A no-op unless the phase is `choosing`. */
  submitDislike: (reasons: readonly DislikeReason[]) => void;
}

/** The slug a session belongs to, so it cannot outlive that game. */
interface Session {
  readonly slug: string;
  readonly phase: ReactionPhase;
}

/**
 * Tracks the like/dislike reaction for one day's game.
 *
 * Rating is one-way — the store counts inserts and cannot be decremented,
 * so there is no un-rating — and is scoped to `slug`, so nothing carries
 * over when tomorrow's game replaces today's, including when the manifest
 * is swapped in place without a remount.
 *
 * @param config Where to send the row. A `null` `endpointUrl` keeps
 *   everything local and issues no request. See {@link buildInsertRequest}.
 * @param fetchImpl Replaces global `fetch`; injected by tests.
 */
export function useReaction(
  slug: string,
  config: ReactionConfig,
  fetchImpl?: typeof fetch,
): UseReactionResult {
  // Keyed by slug rather than a bare phase, and derived rather than
  // synchronized, so no effect is needed to reset it when the day rolls.
  const [session, setSession] = useState<Session | null>(null);
  const storage = localStorageOrNull();
  const current = session?.slug === slug ? session : null;
  const phase: ReactionPhase =
    current?.phase ?? (readReaction(storage, slug) === null ? 'idle' : 'submitted');

  const commit = (kind: ReactionKind, reasons: readonly DislikeReason[]): void => {
    setSession({ slug, phase: 'submitted' });
    rememberReaction(storage, slug, { kind, reasons });
    // Deliberately not awaited: the store is decoration, nothing on screen
    // waits for it, and `sendReaction` never rejects.
    void sendReaction(buildInsertRequest(config, { slug, reaction: kind, reasons }), { fetchImpl });
  };

  return {
    phase,
    like: () => {
      if (phase !== 'idle') return;
      commit('like', []);
    },
    beginDislike: () => {
      if (phase !== 'idle') return;
      setSession({ slug, phase: 'choosing' });
    },
    submitDislike: (reasons) => {
      if (phase !== 'choosing') return;
      commit('dislike', reasons);
    },
  };
}
