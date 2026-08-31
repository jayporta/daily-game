import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeByok, type ByokCompletionResult, type ByokRequest } from '../providers.ts';

/** Narrows to the failure variant, failing the test if the call succeeded. */
function failureMessage(result: ByokCompletionResult): string {
  if (result.ok) assert.fail(`expected a failure, got: ${result.text}`);
  return result.message;
}

function baseRequest(overrides: Partial<ByokRequest> = {}): ByokRequest {
  return {
    provider: 'openrouter',
    model: 'a/model:free',
    apiKey: 'test-key',
    systemPrompt: 'system instructions',
    userPrompt: 'user prompt text',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Captures the single fetch call a test makes, for asserting request shape. */
function capturingFetch(response: Response): { fetchImpl: typeof fetch; calls: [string, RequestInit | undefined][] } {
  const calls: [string, RequestInit | undefined][] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push([String(url), init]);
    return response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test('completeByok sends OpenRouter requests to the documented url with a Bearer key', async () => {
  const { fetchImpl, calls } = capturingFetch(
    jsonResponse({ choices: [{ message: { content: 'the completion' } }] }),
  );

  const result = await completeByok(baseRequest({ provider: 'openrouter' }), { fetchImpl });

  assert.deepEqual(result, { ok: true, text: 'the completion' });
  assert.equal(calls[0]?.[0], 'https://openrouter.ai/api/v1/chat/completions');
  const headers = calls[0]?.[1]?.headers as Record<string, string>;
  assert.equal(headers['Authorization'], 'Bearer test-key');
  const body = JSON.parse(String(calls[0]?.[1]?.body));
  assert.equal(body.messages[0].content, 'system instructions');
  assert.equal(body.messages[1].content, 'user prompt text');
});

test('completeByok sends OpenAI requests to the documented url with a Bearer key', async () => {
  const { fetchImpl, calls } = capturingFetch(
    jsonResponse({ choices: [{ message: { content: 'the completion' } }] }),
  );

  const result = await completeByok(baseRequest({ provider: 'openai' }), { fetchImpl });

  assert.deepEqual(result, { ok: true, text: 'the completion' });
  assert.equal(calls[0]?.[0], 'https://api.openai.com/v1/chat/completions');
  const headers = calls[0]?.[1]?.headers as Record<string, string>;
  assert.equal(headers['Authorization'], 'Bearer test-key');
});

test('completeByok sends Anthropic requests with the required browser-access header', async () => {
  const { fetchImpl, calls } = capturingFetch(jsonResponse({ content: [{ text: 'the completion' }] }));

  const result = await completeByok(baseRequest({ provider: 'anthropic' }), { fetchImpl });

  assert.deepEqual(result, { ok: true, text: 'the completion' });
  assert.equal(calls[0]?.[0], 'https://api.anthropic.com/v1/messages');
  const headers = calls[0]?.[1]?.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'test-key');
  assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true');
  const body = JSON.parse(String(calls[0]?.[1]?.body));
  assert.equal(body.system, 'system instructions');
  assert.equal(body.messages[0].content, 'user prompt text');
});

test('completeByok sends Gemini requests with the model id in the url path, not the body', async () => {
  const { fetchImpl, calls } = capturingFetch(
    jsonResponse({ candidates: [{ content: { parts: [{ text: 'the completion' }] } }] }),
  );

  const result = await completeByok(baseRequest({ provider: 'gemini', model: 'gemini-2.5-flash' }), {
    fetchImpl,
  });

  assert.deepEqual(result, { ok: true, text: 'the completion' });
  assert.equal(
    calls[0]?.[0],
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  );
  const headers = calls[0]?.[1]?.headers as Record<string, string>;
  assert.equal(headers['x-goog-api-key'], 'test-key');
  const body = JSON.parse(String(calls[0]?.[1]?.body));
  assert.equal(body.model, undefined);
  assert.equal(body.systemInstruction.parts[0].text, 'system instructions');
});

for (const provider of ['openrouter', 'openai', 'anthropic', 'gemini'] as const) {
  test(`completeByok(${provider}) returns a failure when the response is missing the expected text`, async () => {
    const { fetchImpl } = capturingFetch(jsonResponse({ unexpected: 'shape' }));

    const result = await completeByok(baseRequest({ provider }), { fetchImpl });

    assert.match(failureMessage(result), /did not carry the expected completion text/);
  });

  test(`completeByok(${provider}) returns a failure with the status on a non-OK response`, async () => {
    const { fetchImpl } = capturingFetch(new Response('', { status: 401 }));

    const result = await completeByok(baseRequest({ provider }), { fetchImpl });

    assert.match(failureMessage(result), /401/);
  });
}

test('completeByok truncates an embedded error message rather than showing it raw', async () => {
  const longMessage = 'x'.repeat(500);
  const { fetchImpl } = capturingFetch(
    new Response(JSON.stringify({ error: { message: longMessage } }), { status: 400 }),
  );

  const result = await completeByok(baseRequest(), { fetchImpl });

  assert.ok(failureMessage(result).length < longMessage.length);
});

test('completeByok reports an unreachable provider without throwing', async () => {
  const fetchImpl = (async () => {
    throw new Error('network down');
  }) as typeof fetch;

  const result = await completeByok(baseRequest(), { fetchImpl });

  assert.match(failureMessage(result), /network down/);
});

// A `throw` can carry anything, and this message is rendered into the
// panel. Coercing the thrown value directly would show the visitor the
// literal string "undefined" here.
test('completeByok renders a non-Error rejection without leaking "undefined"', async () => {
  const fetchImpl = (async () => {
    throw undefined;
  }) as typeof fetch;

  const result = await completeByok(baseRequest(), { fetchImpl });

  assert.match(failureMessage(result), /unknown error/);
});

test('completeByok returns a failure when the response body is not JSON', async () => {
  const { fetchImpl } = capturingFetch(new Response('not json', { status: 200 }));

  const result = await completeByok(baseRequest(), { fetchImpl });

  assert.match(failureMessage(result), /not JSON/);
});
