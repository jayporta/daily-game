// Parses AI model output expected to contain exactly two fenced code
// blocks: a ```json block (meta: title/genre/theme/mechanics) and a
// ```html block (a single self-contained game HTML file).
//
// Pure and dependency-free so it runs identically under Node (the daily
// pipeline) and in a browser (BYOK mode) once compiled for that context.

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

const JSON_BLOCK_RE = /```json\s*\r?\n([\s\S]*?)```/i;
const HTML_BLOCK_RE = /```html\s*\r?\n([\s\S]*?)```/i;

/**
 * Bounds on reported controls. They render in the parent page, so a model
 * that emits five hundred of them, or a paragraph per key, must not turn
 * the metadata strip into the page.
 */
const MAX_CONTROLS = 10;
const MAX_CONTROL_TEXT = 40;

/**
 * Stable, collision-free identity for a control pair.
 *
 * JSON rather than a joined string: a separator can appear inside
 * model-authored text, so `action + ':' + key` would conflate
 * `{"A:B", "C"}` with `{"A", "B:C"}`.
 */
export function controlIdentity(control: ControlHint): string {
  return JSON.stringify([control.action, control.key]);
}

function boundedText(value: unknown): string {
  return String(value).trim().slice(0, MAX_CONTROL_TEXT);
}

/**
 * Keeps only entries naming both an action and an input.
 *
 * Permissive in the same spirit as the rest of this module: a malformed
 * control costs its own line, never the whole bundle.
 */
function extractControls(value: unknown): ControlHint[] {
  if (!Array.isArray(value)) return [];

  const controls: ControlHint[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (controls.length === MAX_CONTROLS) break;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    if (!('action' in entry) || !('key' in entry)) continue;

    const action = boundedText(entry.action);
    const key = boundedText(entry.key);
    if (action.length === 0 || key.length === 0) continue;

    // Deduped before the cap, not after: a model repeating one control
    // forty times would otherwise spend the whole budget on it and push
    // every real control off the legend.
    const identity = controlIdentity({ action, key });
    if (seen.has(identity)) continue;
    seen.add(identity);

    controls.push({ action, key });
  }
  return controls;
}

/**
 * Deliberately permissive: any object passes, and missing fields are
 * coerced to empty defaults below rather than rejected. Extraction's job
 * is parsing the format, not judging the content — a game with a blank
 * title still has to clear moderation and the smoke test before it can
 * ever be published, so rejecting here would only cost a retry.
 */
function isPartialMeta(value: unknown): value is Partial<GeneratedMeta> {
  return typeof value === 'object' && value !== null;
}

export function extractBundle(rawText: unknown): ExtractedBundle {
  if (typeof rawText !== 'string') {
    return { ok: false, reason: 'missing-meta-block' };
  }

  const jsonMatch = rawText.match(JSON_BLOCK_RE);
  if (!jsonMatch || jsonMatch[1] === undefined) {
    return { ok: false, reason: 'missing-meta-block' };
  }

  const htmlMatch = rawText.match(HTML_BLOCK_RE);
  if (!htmlMatch || htmlMatch[1] === undefined) {
    return { ok: false, reason: 'missing-html-block' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[1].trim());
  } catch {
    return { ok: false, reason: 'invalid-json-meta' };
  }

  if (!isPartialMeta(parsed)) {
    return { ok: false, reason: 'invalid-json-meta' };
  }

  const html = htmlMatch[1].trim();
  if (html.length === 0) {
    return { ok: false, reason: 'empty-html' };
  }

  const meta: GeneratedMeta = {
    title: String(parsed.title ?? ''),
    genre: String(parsed.genre ?? ''),
    theme: String(parsed.theme ?? ''),
    mechanics: Array.isArray(parsed.mechanics) ? parsed.mechanics.map(String) : [],
    controls: extractControls(parsed.controls),
  };

  return { ok: true, meta, html };
}
