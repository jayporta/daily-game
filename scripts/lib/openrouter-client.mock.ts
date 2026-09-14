// Mock OpenRouter client: returns canned fixture text in sequence,
// deterministically, so pipeline tests and the local dry run never need
// the network.
//
// Generation, moderation and reflection share one client, so the mock
// answers the latter two with fixed replies and reserves the fixture
// sequence for generation calls only.

import { isLessonsRequest } from '#scripts/lib/lessons-prompt.ts';
import type {
  CompletionRequest,
  CompletionResult,
  OpenRouterClient,
} from '#scripts/lib/openrouter-client.ts';
import { isModerationRequest } from '#scripts/moderate.ts';

export interface CreateMockOpenRouterClientOptions {
  fixtureSequence?: string[];
  /** Verdict returned for moderation calls. Defaults to approving. */
  moderationVerdict?: string;
  /** Note returned for reflection calls. */
  lessonsNote?: string;
}

/**
 * Stands in for a distilled lessons note.
 *
 * Plausible prose rather than a fixture: answering a reflection call with a
 * generation fixture writes a whole game bundle into `summary.json`, which
 * then goes into every later prompt as guidance.
 */
const MOCK_LESSONS =
  'Mock run: no real lessons have been distilled. Recent games ran without ' +
  'uncaught errors, and nothing recurring has been recorded yet.';

export function createMockOpenRouterClient({
  fixtureSequence = [],
  moderationVerdict = 'PASS',
  lessonsNote = MOCK_LESSONS,
}: CreateMockOpenRouterClientOptions = {}): OpenRouterClient {
  let callIndex = 0;
  return {
    async complete({ messages }: CompletionRequest): Promise<CompletionResult> {
      if (isModerationRequest(messages)) return { text: moderationVerdict, stop: 'complete' };
      if (isLessonsRequest(messages)) return { text: lessonsNote, stop: 'complete' };

      const fixture = fixtureSequence[callIndex];
      if (fixture === undefined) {
        throw new Error(`createMockOpenRouterClient: no fixture left for call #${callIndex + 1}`);
      }
      callIndex += 1;
      return { text: fixture, stop: 'complete' };
    },
  };
}
