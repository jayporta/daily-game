// Single seam the rest of the pipeline depends on: returns the real
// OpenRouter client when OPENROUTER_API_KEY is set, otherwise a mock
// seeded with fixture responses. The rest of the pipeline never branches
// on mock-vs-real — it just calls client.complete(...).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockOpenRouterClient } from '#actions_pipeline/lib/openrouter-client.mock.ts';
import {
  createOpenRouterClient,
  type OpenRouterClient,
} from '#actions_pipeline/lib/openrouter-client.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/mock-responses/', import.meta.url));

function loadDefaultFixtures(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.startsWith('good-') && name.endsWith('.txt'))
    .sort()
    .map((name) => readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

/** Options for {@link getOpenRouterClient}. */
export interface GetOpenRouterClientOptions {
  /**
   * Return the mock even when `OPENROUTER_API_KEY` is set.
   *
   * @remarks
   * `npm run dry-run` does *not* set this. Its `--dry-run` flag suppresses
   * writes to disk, not provider calls, so a dry run with a live key in
   * `.env` still spends money.
   *
   * @defaultValue `false`
   */
  forceMock?: boolean;
  /**
   * Responses the mock hands out to generation calls, one per call, in
   * order. Moderation and lessons calls are answered from their own canned
   * replies and never draw from this.
   *
   * Defaults to the `good-*.txt` fixtures on disk.
   */
  fixtureSequence?: string[];
}

/**
 * The pipeline's only choice between a real provider and a mock.
 *
 * @remarks
 * Nothing downstream branches on mock-vs-real, which is what lets setting
 * `OPENROUTER_API_KEY` flip the whole pipeline live with no code change.
 * Keep the decision here.
 *
 * @param options - See {@link GetOpenRouterClientOptions}.
 * @returns A live client when a key is present and the mock is not forced;
 * otherwise a mock seeded with `fixtureSequence` or the fixtures on disk.
 */
export function getOpenRouterClient({
  forceMock = false,
  fixtureSequence,
}: GetOpenRouterClientOptions = {}): OpenRouterClient {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!forceMock && apiKey) {
    return createOpenRouterClient({ apiKey });
  }
  return createMockOpenRouterClient({ fixtureSequence: fixtureSequence ?? loadDefaultFixtures() });
}
