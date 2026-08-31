// The single pointer the front-end reads on every load: written by
// publish.ts, consumed by the React viewer. In lib/ because both sides
// compile it, so the writer and the reader can never drift apart.
import type { ControlHint } from './extract-bundle-shared.ts';

export interface Manifest {
  date: string;
  slug: string;
  path: string;
  /** Where the exact prompt that produced this game is published — see BYOK. */
  promptPath: string;
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
