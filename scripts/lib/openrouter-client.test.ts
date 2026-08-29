import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouterClient } from './openrouter-client.ts';
import { createMockOpenRouterClient } from './openrouter-client.mock.ts';

test('mock client returns fixtures in sequence', async () => {
  const client = createMockOpenRouterClient({ fixtureSequence: ['first', 'second'] });
  assert.equal(await client.complete({ model: 'm', messages: [], temperature: 0.7 }), 'first');
  assert.equal(await client.complete({ model: 'm', messages: [], temperature: 0.7 }), 'second');
});

test('mock client throws once fixtures are exhausted', async () => {
  const client = createMockOpenRouterClient({ fixtureSequence: ['only'] });
  await client.complete({ model: 'm', messages: [], temperature: 0.7 });
  await assert.rejects(() => client.complete({ model: 'm', messages: [], temperature: 0.7 }));
});

test('real client shapes the request correctly and parses the response', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  const fetchImpl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'generated text' } }] }), {
      status: 200,
    });
  };

  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl: fetchImpl as typeof fetch });
  const result = await client.complete({ model: 'a/model:free', messages: [{ role: 'user', content: 'hi' }], temperature: 0.9 });

  assert.equal(result, 'generated text');
  assert.equal(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(capturedInit?.method, 'POST');
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(capturedInit?.body as string);
  assert.equal(body.model, 'a/model:free');
  assert.equal(body.temperature, 0.9);
});

test('real client throws on a non-ok response', async () => {
  const fetchImpl = async (): Promise<Response> => new Response('rate limited', { status: 429 });
  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl: fetchImpl as typeof fetch });
  await assert.rejects(
    () => client.complete({ model: 'm', messages: [], temperature: 0.7 }),
    /OpenRouter request failed: 429/,
  );
});

test('real client throws when response is missing content', async () => {
  const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify({ choices: [] }), { status: 200 });
  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl: fetchImpl as typeof fetch });
  await assert.rejects(() => client.complete({ model: 'm', messages: [], temperature: 0.7 }));
});

test('createOpenRouterClient requires an apiKey', () => {
  assert.throws(() => createOpenRouterClient({ apiKey: '' }));
});
