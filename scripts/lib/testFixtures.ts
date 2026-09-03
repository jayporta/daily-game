// Shared fixture loading for tests and for the mock client, so no test
// hardcodes the fixtures directory path or re-implements extraction.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratedMeta } from '#lib/extract-bundle-shared.ts';
import { extractBundle } from '#lib/extract-bundle-shared.ts';
import type { GenerationConfig } from '#scripts/lib/config/generation.ts';
import type { GenresConfig } from '#scripts/lib/config/genres.ts';
import type { HistoryGameEntry } from '#scripts/lib/history-store.ts';

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

/**
 * A genre catalogue shaped like the real one — ids, readable labels and
 * non-empty examples, so it also satisfies `validateGenresConfig`.
 */
export const GENRES: GenresConfig = [
  { id: 'maze-adventure', label: 'Maze Adventure', examples: ['navigate a maze'] },
  { id: 'platformer', label: 'Platformer', examples: ['jump between platforms'] },
  { id: 'puzzle', label: 'Puzzle', examples: ['rearrange tiles'] },
];

/** The generation knobs, matching `config/generation.json`'s shape. */
export const GENERATION_CONFIG: GenerationConfig = {
  historyHotWindowDays: 45,
  rollupTriggerEntries: 60,
  remixProbability: 0.2,
  remixLookbackDays: 90,
  retryTemperatures: [0.7, 0.9, 1.0],
  sentryDsn: null,
  cronSchedule: '0 13 * * *',
};

/** The published day's slug. Separate because `slug` is optional on {@link HistoryGameEntry}. */
export const PUBLISHED_SLUG = '2026-08-28-beetle';

/** A day that published, as `publish.ts` records it. */
export const PUBLISHED_ENTRY: HistoryGameEntry = {
  date: '2026-08-28',
  status: 'published',
  model: 'a/model:free',
  slug: PUBLISHED_SLUG,
  genre: 'maze-adventure',
  theme: 'glass beetles',
  mechanics: ['move'],
  title: 'Beetle Maze',
};

/** A day that gave up after three attempts and kept the previous game. */
export const FAILED_ENTRY: HistoryGameEntry = {
  date: '2026-08-29',
  status: 'failed_kept_previous',
  model: 'b/model:free',
  attempts: 3,
};
