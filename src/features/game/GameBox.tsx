import type { ReactNode } from 'react';

/** What the box is painted with behind its occupant. */
export type GameBoxGround = 'none' | 'console';

/**
 * Complete class strings per ground, never assembled from fragments: Tailwind
 * only generates the classes it can read whole in the source.
 *
 * `none` lets the game paint its own background to the edges; `console` sets
 * the terminal ground the streaming output reads against.
 */
const BOX: Record<GameBoxGround, string> = {
  none: 'aspect-game w-full overflow-hidden rounded-xl shadow-frame',
  console: 'aspect-game w-full overflow-hidden rounded-xl bg-slate-950 shadow-frame',
};

export interface GameBoxProps {
  /** Which ground to paint. See {@link GameBoxGround}. */
  readonly ground: GameBoxGround;
  /** The frame, or the generation console standing in for it. */
  readonly children: ReactNode;
}

/**
 * The box the day's game occupies, and that a visitor's generation occupies
 * while it runs.
 *
 * One definition of that shape, because the two take turns in the same place
 * and the page must not shift when one replaces the other.
 *
 * `overflow-hidden` is what rounds the corners: an iframe cannot be clipped by
 * its own `border-radius` once the game paints to its edges.
 */
export function GameBox({ ground, children }: GameBoxProps) {
  return <div className={BOX[ground]}>{children}</div>;
}
