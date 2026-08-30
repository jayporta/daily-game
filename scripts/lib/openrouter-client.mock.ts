// Mock OpenRouter client: returns canned fixture text in sequence,
// deterministically, so pipeline tests and the local dry run never need
// the network.
//
// Generation and moderation share one client, so the mock answers
// moderation calls with a fixed verdict and reserves the fixture sequence
// for generation calls only.
import { isModerationRequest } from '../moderate.ts';
import type { CompletionRequest, OpenRouterClient } from './openrouter-client.ts';

export interface CreateMockOpenRouterClientOptions {
  fixtureSequence?: string[];
  /** Verdict returned for moderation calls. Defaults to approving. */
  moderationVerdict?: string;
}

export function createMockOpenRouterClient({
  fixtureSequence = [],
  moderationVerdict = 'PASS',
}: CreateMockOpenRouterClientOptions = {}): OpenRouterClient {
  let callIndex = 0;
  return {
    async complete({ messages }: CompletionRequest): Promise<string> {
      if (isModerationRequest(messages)) return moderationVerdict;

      const fixture = fixtureSequence[callIndex];
      if (fixture === undefined) {
        throw new Error(`createMockOpenRouterClient: no fixture left for call #${callIndex + 1}`);
      }
      callIndex += 1;
      return fixture;
    },
  };
}
