// Types for the isomorphic bundle-extraction core. Lives in lib/ (not
// scripts/lib/) because this file ships to the browser for BYOK mode as
// well as running in the Node pipeline — see PLAN.md's architectural note.

export interface GeneratedMeta {
  title: string;
  genre: string;
  theme: string;
  mechanics: string[];
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
  genre: string;
  model: string;
  generatedAt: string;
  expiresAt: string;
}
