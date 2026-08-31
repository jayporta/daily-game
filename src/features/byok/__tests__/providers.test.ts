import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeByok, type ByokCompletionResult, type ByokRequest } from '../providers.ts';
import type { ByokProvider } from '../../../../lib/byok-config-types.ts';

const PROVIDERS = ['openrouter', 'openai', 'anthropic', 'gemini'] as const satisfies readonly ByokProvider[];

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

/**
 * One stream frame carrying `fragment`, in the shape the provider sends.
 *
 * Written out per provider rather than generated, so the frame shapes each
 * API actually documents are visible in the test file.
 */
function deltaFrame(provider: ByokProvider, fragment: string): string {
  switch (provider) {
    case 'openrouter':
    case 'openai':
      return `data: ${JSON.stringify({ choices: [{ delta: { content: fragment } }] })}\n\n`;
    case 'anthropic':
      return `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: fragment } })}\n\n`;
    case 'gemini':
      return `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: fragment }] } }] })}\n\n`;
  }
}

/** A streaming response emitting one frame per fragment. */
function streamOf(provider: ByokProvider, fragments: readonly string[]): Response {
  const body = fragments.map((fragment) => deltaFrame(provider, fragment)).join('');
  return new Response(body, { status: 200 });
}

/** Captures the single fetch call a test makes, for asserting request shape. */
function capturingFetch(response: Response): { fetchImpl: typeof fetch; calls: [string, RequestInit | undefined][] } {
  const calls: [string, RequestInit | undefined][] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push([String(url), init]);
    return response;
  };
  return { fetchImpl, calls };
}

test('completeByok sends OpenRouter requests to the documented url with a Bearer key', async () => {
  const { fetchImpl, calls } = capturingFetch(streamOf('openrouter', ['the completion']));

  const result = await completeByok(baseRequest({ provider: 'openrouter' }), { fetchImpl });

  assert.deepEqual(result, { ok: true, text: 'the completion' });
  assert.equal(calls[0]?.[0], 'https://openrouter.ai/api/v1/chat/completions');
  const headers = new Headers(calls[0]?.[1]?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer test-key');
  const body = JSON.parse(String(calls[0]?.[1]?.body));
  assert.equal(body.messages[0].content, 'system instructions');
  assert.equal(body.messages[1].content, 'user prompt text');
});

test('completeByok sends OpenAI requests to the documented url with a Bearer key', async () => {
  const { fetchImpl, calls } = capturingFetch(streamOf('openai', ['the completion']));

  const result = await completeByok(baseRequest({ provider: 'openai' }), { fetchImpl });

  assert.deepEqual(result, { ok: true, text: 'the completion' });
  assert.equal(calls[0]?.[0], 'https://api.openai.com/v1/chat/completions');
  const headers = new Headers(calls[0]?.[1]?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer test-key');
});

// GPT-5 and the o-series reject `max_tokens` outright, so a direct OpenAI
// call that sent it would fail for every model currently offered.
test('completeByok caps OpenAI output with max_completion_tokens, not max_tokens', async () => {
  const { fetchImpl, calls } = capturingFetch(streamOf('openai', ['x']));

  await completeByok(baseRequest({ provider: 'openai' }), { fetchImpl });

  const body = JSON.parse(String(calls[0]?.[1]?.body));
  assert.ok(body.max_completion_tokens > 0);
  assert.equal(body.max_tokens, undefined);
});

// OpenRouter normalises the older name across every provider it fronts.
test('completeByok caps OpenRouter output with max_tokens', async () => {
  const { fetchImpl, calls } = capturingFetch(streamOf('openrouter', ['x']));

  await completeByok(baseRequest({ provider: 'openrouter' }), { fetchImpl });

  const body = JSON.parse(String(calls[0]?.[1]?.body));
  assert.ok(body.max_tokens > 0);
  assert.equal(body.max_completion_tokens, undefined);
});

test('completeByok sends Anthropic requests with the required browser-access header', async () => {
  const { fetchImpl, calls } = capturingFetch(streamOf('anthropic', ['the completion']));

  const result = await completeByok(baseRequest({ provider: 'anthropic' }), { fetchImpl });

  assert.deepEqual(result, { ok: true, text: 'the completion' });
  assert.equal(calls[0]?.[0], 'https://api.anthropic.com/v1/messages');
  const headers = new Headers(calls[0]?.[1]?.headers);
  assert.equal(headers.get('x-api-key'), 'test-key');
  assert.equal(headers.get('anthropic-dangerous-direct-browser-access'), 'true');
  const body = JSON.parse(String(calls[0]?.[1]?.body));
  assert.equal(body.system, 'system instructions');
  assert.equal(body.messages[0].content, 'user prompt text');
});

test('completeByok sends Gemini requests with the model id in the url path, not the body', async () => {
  const { fetchImpl, calls } = capturingFetch(streamOf('gemini', ['the completion']));

  const result = await completeByok(baseRequest({ provider: 'gemini', model: 'gemini-2.5-flash' }), {
    fetchImpl,
  });

  assert.deepEqual(result, { ok: true, text: 'the completion' });
  const headers = new Headers(calls[0]?.[1]?.headers);
  assert.equal(headers.get('x-goog-api-key'), 'test-key');
  const body = JSON.parse(String(calls[0]?.[1]?.body));
  assert.equal(body.model, undefined);
  assert.equal(body.systemInstruction.parts[0].text, 'system instructions');
});

// Without `alt=sse` the endpoint answers with an incrementally-delivered JSON
// array, which the frame reader cannot parse — the call would look like a
// model that returned nothing.
test('completeByok asks Gemini for a server-sent event stream', async () => {
  const { fetchImpl, calls } = capturingFetch(streamOf('gemini', ['x']));

  await completeByok(baseRequest({ provider: 'gemini', model: 'gemini-2.5-flash' }), { fetchImpl });

  assert.equal(
    calls[0]?.[0],
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
  );
});

for (const provider of PROVIDERS) {
  test(`completeByok(${provider}) asks for a stream and assembles the fragments in order`, async () => {
    const { fetchImpl } = capturingFetch(streamOf(provider, ['Hello', ', ', 'world']));

    const result = await completeByok(baseRequest({ provider }), { fetchImpl });

    assert.deepEqual(result, { ok: true, text: 'Hello, world' });
  });

  test(`completeByok(${provider}) reports each fragment as it arrives`, async () => {
    const { fetchImpl } = capturingFetch(streamOf(provider, ['Hello', ', ', 'world']));
    const seen: string[] = [];

    await completeByok(baseRequest({ provider }), { fetchImpl, onDelta: (f) => seen.push(f) });

    assert.deepEqual(seen, ['Hello', ', ', 'world']);
  });

  test(`completeByok(${provider}) returns a failure when the stream carries no text`, async () => {
    const { fetchImpl } = capturingFetch(new Response('data: {"unexpected":"shape"}\n\n', { status: 200 }));

    const result = await completeByok(baseRequest({ provider }), { fetchImpl });

    assert.match(failureMessage(result), /returned no output/);
  });

  test(`completeByok(${provider}) returns a failure with the status on a non-OK response`, async () => {
    const { fetchImpl } = capturingFetch(new Response('', { status: 401 }));

    const result = await completeByok(baseRequest({ provider }), { fetchImpl });

    assert.match(failureMessage(result), /401/);
  });
}

// Without this the provider answers with one whole JSON document, which
// carries no `data:` frames at all — the call would read as a model that
// returned nothing, for every provider at once.
test('completeByok asks the OpenAI-shaped APIs to stream', async () => {
  for (const provider of ['openrouter', 'openai'] as const) {
    const { fetchImpl, calls } = capturingFetch(streamOf(provider, ['x']));

    await completeByok(baseRequest({ provider }), { fetchImpl });

    assert.equal(JSON.parse(String(calls[0]?.[1]?.body)).stream, true, provider);
  }
});

test('completeByok asks Anthropic to stream', async () => {
  const { fetchImpl, calls } = capturingFetch(streamOf('anthropic', ['x']));

  await completeByok(baseRequest({ provider: 'anthropic' }), { fetchImpl });

  assert.equal(JSON.parse(String(calls[0]?.[1]?.body)).stream, true);
});

// The frames before and after the text carry no content — a role
// announcement, a ping, a stop reason. Treating those as "no output" would
// fail every real call.
test('completeByok ignores the frames around the text that carry none', async () => {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'the game' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
  ].join('');
  const { fetchImpl } = capturingFetch(new Response(body, { status: 200 }));

  const result = await completeByok(baseRequest({ provider: 'openrouter' }), { fetchImpl });

  assert.deepEqual(result, { ok: true, text: 'the game' });
});

test('completeByok stops at the end-of-stream sentinel', async () => {
  const body = `${deltaFrame('openrouter', 'kept')}data: [DONE]\n\n${deltaFrame('openrouter', 'after')}`;
  const { fetchImpl } = capturingFetch(new Response(body, { status: 200 }));

  const result = await completeByok(baseRequest(), { fetchImpl });

  assert.deepEqual(result, { ok: true, text: 'kept' });
});

// OpenRouter answers 200 and then reports an exhausted balance or an upstream
// refusal in a frame. Without this the run reads as a model that said
// nothing, and the visitor never learns why.
test('completeByok surfaces an error reported inside the stream', async () => {
  const body = `data: ${JSON.stringify({ error: { message: 'insufficient credits' } })}\n\n`;
  const { fetchImpl } = capturingFetch(new Response(body, { status: 200 }));

  const result = await completeByok(baseRequest(), { fetchImpl });

  assert.match(failureMessage(result), /insufficient credits/);
});

test('completeByok truncates an error reported inside the stream', async () => {
  const longMessage = 'x'.repeat(500);
  const body = `data: ${JSON.stringify({ error: { message: longMessage } })}\n\n`;
  const { fetchImpl } = capturingFetch(new Response(body, { status: 200 }));

  const result = await completeByok(baseRequest(), { fetchImpl });

  assert.ok(failureMessage(result).length < longMessage.length);
});

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

test('completeByok returns a failure when the body is not an event stream at all', async () => {
  const { fetchImpl } = capturingFetch(new Response('not json', { status: 200 }));

  const result = await completeByok(baseRequest(), { fetchImpl });

  assert.match(failureMessage(result), /returned no output/);
});

// A connection dropped mid-generation rejects the body reader. The visitor
// has to be told, not left watching a console that stopped moving.
test('completeByok reports a stream that dies part-way through', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(deltaFrame('openrouter', 'half a ')));
      controller.error(new Error('connection reset'));
    },
  });
  const { fetchImpl } = capturingFetch(new Response(body, { status: 200 }));

  const result = await completeByok(baseRequest(), { fetchImpl });

  assert.match(failureMessage(result), /connection reset/);
});

test('completeByok forwards an abort signal to the provider', async () => {
  const controller = new AbortController();
  const { fetchImpl, calls } = capturingFetch(streamOf('openrouter', ['x']));

  await completeByok(baseRequest(), { fetchImpl, signal: controller.signal });

  assert.equal(calls[0]?.[1]?.signal, controller.signal);
});

// What the Stop button does: the run has to end, not hang on a body that
// will never close.
test('completeByok ends the run when the caller aborts mid-stream', async () => {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(source) {
      source.enqueue(encoder.encode(deltaFrame('openrouter', 'half a ')));
      // A real fetch errors the body when its signal aborts.
      controller.signal.addEventListener('abort', () => source.error(new Error('aborted')));
    },
  });
  const fetchImpl: typeof fetch = async () => new Response(body, { status: 200 });

  const finished = completeByok(baseRequest(), { fetchImpl, signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();

  assert.match(failureMessage(await finished), /aborted/);
});
