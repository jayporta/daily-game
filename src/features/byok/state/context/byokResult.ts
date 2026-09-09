// One finished BYOK generation, in the shape the page renders it.
//
// Flatter than `ByokGeneration`, which is what `useByok` hands back: the
// frame and the metadata card read a title and a control list, not a whole
// `GeneratedMeta`.
import type { ControlHint } from '#lib/extract-bundle-shared.ts';

/** A visitor's own generation, shown in place of the day's game. */
export interface ByokResult {
  readonly html: string;
  readonly title: string;
  /**
   * The regenerated game's own controls — not the day's. The legend describes
   * whatever game is in the frame, and a BYOK game invents its own scheme.
   */
  readonly controls: readonly ControlHint[];
  readonly providerLabel: string;
  readonly modelId: string;
}
