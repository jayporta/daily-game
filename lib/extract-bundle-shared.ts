// Parses AI model output expected to contain exactly two fenced code
// blocks: a ```json block (meta: title/genre/theme/mechanics) and a
// ```html block (a single self-contained game HTML file).
//
// Pure and dependency-free so it runs identically under Node (the daily
// pipeline) and in a browser (BYOK mode) once compiled for that context —
// see PLAN.md's "Technology choices".
import type { ExtractedBundle, GeneratedMeta } from './types.ts';

const JSON_BLOCK_RE = /```json\s*\r?\n([\s\S]*?)```/i;
const HTML_BLOCK_RE = /```html\s*\r?\n([\s\S]*?)```/i;

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
  };

  return { ok: true, meta, html };
}
