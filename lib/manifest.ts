// The single pointer the front-end reads on every load: written by
// publish.ts, consumed by the React viewer, and checked by assemble-site.ts
// before a deploy. In lib/ because all three compile it, so the writer and
// the readers can never drift apart.
import { isRecord } from '#lib/guards.ts';
import type { ControlHint } from '#lib/extract-bundle-shared.ts';

/**
 * The pointer to the game currently being served.
 *
 * Every field is required except {@link Manifest.promptPath} — see
 * {@link isManifest}, which is what every reader validates through.
 */
export interface Manifest {
  /** The day this game belongs to, `YYYY-MM-DD`. */
  readonly date: string;
  /** Identifies the game, `YYYY-MM-DD-some-title`. See `SLUG_PATTERN`. */
  readonly slug: string;
  /** Repo-relative path to the published bundle, e.g. `games/archive/<slug>/game.html`. */
  readonly path: string;
  /**
   * Where the exact prompt that produced this game is published — see BYOK.
   * Absent for a game archived before prompts were, which is showable but
   * cannot be remixed.
   */
  readonly promptPath?: string;
  /** The game's name, as the model chose it. */
  readonly title: string;
  /** The genre id, as the model chose it. */
  readonly genre: string;
  /**
   * The genre's readable name, resolved from `config/genres.json` at
   * publish time. Resolved rather than derived: title-casing the id would
   * turn `growth-sim` into "Growth Sim", not "Growth Simulation".
   */
  readonly genreLabel: string;
  /** The model that wrote the game, as the provider names it. */
  readonly model: string;
  /** ISO timestamp of the run that produced this game. */
  readonly generatedAt: string;
  /**
   * ISO timestamp of the next scheduled generation, which the front-end
   * counts down to. Derived from `cronSchedule` by `computeExpiresAt`.
   */
  readonly expiresAt: string;
  /** What the game says it listens for. Empty when it reported none. */
  readonly controls: readonly ControlHint[];
}

/**
 * The mandatory string-valued fields of {@link Manifest}, so the guard can't
 * drift. Exported for the test that deletes each one in turn.
 *
 * {@link Manifest.promptPath} is deliberately absent: it is optional, and is
 * checked separately by {@link isManifest}.
 */
export const REQUIRED_STRING_FIELDS = [
  'date',
  'slug',
  'path',
  'title',
  'genre',
  'genreLabel',
  'model',
  'generatedAt',
  'expiresAt',
] as const satisfies readonly (keyof Manifest)[];

function isControlHint(value: unknown): value is ControlHint {
  if (!isRecord(value)) return false;
  if (!('action' in value) || !('key' in value)) return false;
  return typeof value.action === 'string' && typeof value.key === 'string';
}

/**
 * Full shape check. The manifest is written by our own pipeline, but the
 * seed-state file is `null` until the first game publishes, and a partial
 * one would otherwise render blank metadata rather than failing visibly.
 *
 * @param value Parsed JSON of unknown shape.
 */
export function isManifest(value: unknown): value is Manifest {
  if (!isRecord(value)) return false;
  if (!REQUIRED_STRING_FIELDS.every((field) => typeof value[field] === 'string')) return false;
  const promptPath: unknown = value['promptPath'];
  if (promptPath !== undefined && typeof promptPath !== 'string') return false;
  const controls: unknown = value['controls'];
  return Array.isArray(controls) && controls.every(isControlHint);
}
