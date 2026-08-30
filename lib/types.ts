// Types for the isomorphic bundle-extraction core. Lives in lib/ (not
// scripts/lib/) because this file ships to the browser for BYOK mode as
// well as running in the Node pipeline.

/**
 * One input the game listens for, as the game itself reports it.
 *
 * The control scheme is the model's invention, not ours — the prompt asks
 * it to describe what it built, never prescribes a mapping. `key` is
 * whatever the player does, so it covers "Space" and "Click a tile" alike.
 */
export interface ControlHint {
  /** What the input does, in the game's own words. */
  action: string;
  /** What the player presses, clicks or drags. */
  key: string;
}

export interface GeneratedMeta {
  title: string;
  genre: string;
  theme: string;
  mechanics: string[];
  /** Empty when the game reported none, or reported them unusably. */
  controls: ControlHint[];
}

export type ExtractFailureReason =
  | 'missing-meta-block'
  | 'missing-html-block'
  | 'invalid-json-meta'
  | 'empty-html';

export type ExtractedBundle =
  | { ok: true; meta: GeneratedMeta; html: string }
  | { ok: false; reason: ExtractFailureReason };

/**
 * The single pointer the front-end reads on every load. Written by
 * publish.ts, consumed by the React viewer — shared here so the writer and
 * the reader can never drift apart.
 */
export interface Manifest {
  date: string;
  slug: string;
  path: string;
  title: string;
  /** The genre id, as the model chose it. */
  genre: string;
  /**
   * The genre's readable name, resolved from `config/genres.json` at
   * publish time. Resolved rather than derived: title-casing the id would
   * turn `growth-sim` into "Growth Sim", not "Growth Simulation".
   */
  genreLabel: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
  /** What the game says it listens for. Empty when it reported none. */
  controls: ControlHint[];
}
