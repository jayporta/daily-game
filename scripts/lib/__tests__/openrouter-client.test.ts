import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouterClient } from '#scripts/lib/openrouter-client.ts';
import { createMockOpenRouterClient } from '#scripts/lib/openrouter-client.mock.ts';

test('mock client returns fixtures in sequence', async () => {
  const client = createMockOpenRouterClient({ fixtureSequence: ['first', 'second'] });
  assert.equal((await client.complete({ model: 'm', messages: [], temperature: 0.7 })).text, 'first');
  assert.equal((await client.complete({ model: 'm', messages: [], temperature: 0.7 })).text, 'second');
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

  assert.equal(result.text, 'generated text');
  assert.equal(result.stop, 'complete');
  assert.equal(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(capturedInit?.method, 'POST');
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer test-key');
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.model, 'a/model:free');
  assert.equal(body.temperature, 0.9);
  assert.equal(body.max_tokens, 16000);
});

test('a response truncated at the output cap is reported as such', async () => {
  const fetchImpl = async (): Promise<Response> =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: 'cut off mid' }, finish_reason: 'length' }] }),
      { status: 200 },
    );
  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl: fetchImpl as typeof fetch });
  const result = await client.complete({ model: 'm', messages: [], temperature: 0.7 });

  assert.equal(result.text, 'cut off mid');
  assert.equal(result.stop, 'truncated');
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

// The error text is stored in history/games.json, which is public, and is
// shown to the model that rewrites the lessons note. OpenRouter's error
// envelope carries the account's user_id, which belongs in neither.
test('a failed request reports the message without the account id', async () => {
  const body = JSON.stringify({
    error: { message: 'No endpoints found for a/model:free.', code: 404 },
    user_id: 'user_ExampleAccountIdNotARealOne',
  });
  const fetchImpl = async (): Promise<Response> => new Response(body, { status: 404 });
  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl: fetchImpl as typeof fetch });

  await assert.rejects(
    () => client.complete({ model: 'm', messages: [], temperature: 0.7 }),
    (error: Error) => {
      assert.match(error.message, /No endpoints found/);
      assert.doesNotMatch(error.message, /user_/, 'the account id reached the error text');
      return true;
    },
  );
});

test('an unparseable error body is truncated rather than dropped', async () => {
  const fetchImpl = async (): Promise<Response> =>
    new Response('x'.repeat(5_000), { status: 500 });
  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl: fetchImpl as typeof fetch });

  await assert.rejects(
    () => client.complete({ model: 'm', messages: [], temperature: 0.7 }),
    (error: Error) => {
      assert.ok(error.message.length < 300, `error was ${error.message.length} chars`);
      assert.match(error.message, /500/);
      return true;
    },
  );
});

test('createOpenRouterClient requires an apiKey', () => {
  assert.throws(() => createOpenRouterClient({ apiKey: '' }));
});
