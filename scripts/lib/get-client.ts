// Single seam the rest of the pipeline depends on: returns the real
// OpenRouter client when OPENROUTER_API_KEY is set, otherwise a mock
// seeded with fixture responses. The rest of the pipeline never branches
// on mock-vs-real — it just calls client.complete(...).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockOpenRouterClient } from '#scripts/lib/openrouter-client.mock.ts';
import { createOpenRouterClient, type OpenRouterClient } from '#scripts/lib/openrouter-client.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/mock-responses/', import.meta.url));

function loadDefaultFixtures(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.startsWith('good-') && name.endsWith('.txt'))
    .sort()
    .map((name) => readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

export interface GetOpenRouterClientOptions {
  forceMock?: boolean;
  fixtureSequence?: string[];
}

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
