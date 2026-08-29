// Shared fixture loading for tests and for the mock client, so no test
// hardcodes the fixtures directory path or re-implements extraction.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBundle } from '../../lib/extract-bundle-shared.ts';
import type { GeneratedMeta } from '../../lib/types.ts';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/mock-responses/', import.meta.url));

export type FixtureName =
  | 'good-maze'
  | 'good-platformer'
  | 'bad-js-error'
  | 'bad-fetch-attempt'
  | 'bad-guardrail-word'
  | 'bad-malformed-blocks';

/** Raw model-style response text, exactly as the mock client would return it. */
export function loadFixture(name: FixtureName): string {
  return readFileSync(join(FIXTURES_DIR, `${name}.txt`), 'utf8');
}

/** Fixture parsed into its meta + html halves; throws if the fixture is unparseable. */
export function loadFixtureBundle(name: FixtureName): { meta: GeneratedMeta; html: string } {
  const result = extractBundle(loadFixture(name));
  if (!result.ok) {
    throw new Error(`fixture ${name} did not parse: ${result.reason}`);
  }
  return { meta: result.meta, html: result.html };
}
