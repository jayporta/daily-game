// Everything about `config/guardrails.md`: how it is read.
//
// Markdown, not JSON, so there is no shape to validate — only that it is not
// empty. Injected verbatim into both the generation and the moderation
// prompt, which is what keeps the two from drifting apart.
import { readFileSync } from 'node:fs';
import { paths } from '#scripts/lib/paths.ts';

/** @throws If the file is missing or contains nothing but whitespace. */
export function loadGuardrails(filePath: string = paths.guardrails): string {
  const text = readFileSync(filePath, 'utf8').trim();
  if (text.length === 0) {
    throw new Error(`${filePath}: guardrails must not be empty`);
  }
  return text;
}
