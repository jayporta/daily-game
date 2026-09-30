import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockOpenRouterClient } from '#actions_pipeline/lib/openRouterClient.mock.ts';
import {
  createOpenRouterClient,
  isQuotaFailure,
  OpenRouterHttpError,
  resolveServedModel,
} from '#actions_pipeline/lib/openRouterClient.ts';
import {
  neverAnswers,
  sseDelta,
  sseResponse,
  stallsMidStream,
  streamsSlowly,
} from '#actions_pipeline/lib/testFixtures.ts';

/** A `fetch` answering every request with the same stream of frames. */
function streaming(frames: readonly unknown[]): typeof fetch {
  return () => Promise.resolve(sseResponse(frames));
}

test('mock client returns fixtures in sequence', async () => {
  const client = createMockOpenRouterClient({ fixtureSequence: ['first', 'second'] });
  assert.equal(
    (await client.complete({ model: 'm', messages: [], temperature: 0.7 })).text,
    'first',
  );
  assert.equal(
    (await client.complete({ model: 'm', messages: [], temperature: 0.7 })).text,
    'second',
  );
});

test('mock client throws once fixtures are exhausted', async () => {
  const client = createMockOpenRouterClient({ fixtureSequence: ['only'] });
  await client.complete({ model: 'm', messages: [], temperature: 0.7 });
  await assert.rejects(() => client.complete({ model: 'm', messages: [], temperature: 0.7 }));
});

test('real client shapes the request correctly and joins the streamed fragments', async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  const fetchImpl = (url: string | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(url);
    capturedInit = init;
    return Promise.resolve(sseResponse([sseDelta('generated '), sseDelta('text')]));
  };

  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: fetchImpl as typeof fetch,
  });
  const result = await client.complete({
    model: 'a/model:free',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.9,
  });

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

// Not a preference: a request without it answers with one JSON document and
// no `data:` frames at all, which reads here as a model that said nothing.
test('every request asks for a stream', async () => {
  let body: unknown;
  const fetchImpl = (_url: string | URL, init?: RequestInit): Promise<Response> => {
    body = JSON.parse(String(init?.body));
    return Promise.resolve(sseResponse([sseDelta('hi')]));
  };
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: fetchImpl as typeof fetch,
  });
  await client.complete({ model: 'm', messages: [], temperature: 0.7 });

  assert.equal((body as { stream?: unknown }).stream, true);
});

/** The JSON body of the one request `complete` sends for `request`. */
async function sentBody(
  request: Parameters<ReturnType<typeof createOpenRouterClient>['complete']>[0],
): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Promise.resolve(sseResponse([sseDelta('hi')]));
  };
  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl });
  await client.complete(request);
  return body;
}

// OpenRouter reads `models` first when both are present, but a body carrying
// both says two different things about which model is wanted.
test('fallback models are sent as an ordered `models` list with no `model` key', async () => {
  const body = await sentBody({
    model: 'a/primary:free',
    fallbackModels: ['b/second:free', 'c/third:free'],
    messages: [],
    temperature: 0.7,
  });

  assert.deepEqual(body.models, ['a/primary:free', 'b/second:free', 'c/third:free']);
  assert.equal('model' in body, false);
});

test('without fallback models the body carries `model` and no `models`', async () => {
  const body = await sentBody({ model: 'a/primary:free', messages: [], temperature: 0.7 });

  assert.equal(body.model, 'a/primary:free');
  assert.equal('models' in body, false);
});

test('an empty fallback list sends the plain `model` body', async () => {
  const body = await sentBody({
    model: 'a/primary:free',
    fallbackModels: [],
    messages: [],
    temperature: 0.7,
  });

  assert.equal(body.model, 'a/primary:free');
  assert.equal('models' in body, false);
});

test('the result names the model whose frames carried the answer', async () => {
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: streaming([
      sseDelta('hel', undefined, 'b/second:free'),
      sseDelta('lo', undefined, 'b/second:free'),
    ]),
  });
  const result = await client.complete({
    model: 'a/primary:free',
    fallbackModels: ['b/second:free'],
    messages: [],
    temperature: 0.7,
  });

  assert.equal(result.model, 'b/second:free');
});

test('the result names the primary when no frame carries a model', async () => {
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: streaming([sseDelta('hi')]),
  });
  const result = await client.complete({
    model: 'a/primary:free',
    fallbackModels: ['b/second:free'],
    messages: [],
    temperature: 0.7,
  });

  assert.equal(result.model, 'a/primary:free');
});

test('resolveServedModel matches an id exactly', () => {
  assert.equal(
    resolveServedModel('b/second:free', 'a/primary:free', ['b/second:free']),
    'b/second:free',
  );
});

test('resolveServedModel matches when the provider drops the :free suffix', () => {
  assert.equal(
    resolveServedModel('b/second', 'a/primary:free', ['b/second:free']),
    'b/second:free',
  );
});

test('resolveServedModel matches when the provider adds a variant suffix', () => {
  assert.equal(resolveServedModel('b/second:free', 'a/primary', ['b/second']), 'b/second');
});

// A wrong attribution would credit a failure or a success to a model that
// never ran; the primary is the honest default when nothing matches.
test('resolveServedModel falls back to the primary for an id it cannot match', () => {
  assert.equal(
    resolveServedModel('b/second-20260101', 'a/primary:free', ['b/second:free']),
    'a/primary:free',
  );
});

test('resolveServedModel falls back to the primary when no frame named a model', () => {
  assert.equal(resolveServedModel(null, 'a/primary:free', ['b/second:free']), 'a/primary:free');
});

test('a response truncated at the output cap is reported as such', async () => {
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: streaming([sseDelta('cut off mid'), sseDelta('', 'length')]),
  });
  const result = await client.complete({ model: 'm', messages: [], temperature: 0.7 });

  assert.equal(result.text, 'cut off mid');
  assert.equal(result.stop, 'truncated');
});

test('real client throws on a non-ok response', async () => {
  const fetchImpl = (): Promise<Response> =>
    Promise.resolve(new Response('rate limited', { status: 429 }));
  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl });
  await assert.rejects(
    () => client.complete({ model: 'm', messages: [], temperature: 0.7 }),
    /OpenRouter request failed: 429/,
  );
});

// The status is what tells an exhausted quota from a server fault, and the
// message is not a contract worth parsing.
test('a non-ok response carries its status code on the thrown error', async () => {
  const fetchImpl = (): Promise<Response> =>
    Promise.resolve(new Response('rate limited', { status: 429 }));
  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl });

  await assert.rejects(
    () => client.complete({ model: 'm', messages: [], temperature: 0.7 }),
    (error: unknown) => error instanceof OpenRouterHttpError && error.status === 429,
  );
});

// OpenRouter answers 200 and then reports an exhausted quota inside the
// stream. Read only as text, that is a model that said nothing, and the run
// would record a generation fault on a day it should wait for tomorrow.
test('a quota failure sent mid-stream is classified like a refused status', async () => {
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: streaming([{ error: { message: 'rate limit exceeded', code: 429 } }]),
  });

  await assert.rejects(
    () => client.complete({ model: 'm', messages: [], temperature: 0.7 }),
    (error: unknown) => isQuotaFailure(error),
  );
});

test('a mid-stream failure with no code reports its message', async () => {
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: streaming([{ error: { message: 'upstream is unavailable' } }]),
  });

  await assert.rejects(
    () => client.complete({ model: 'm', messages: [], temperature: 0.7 }),
    /upstream is unavailable/,
  );
});

test('isQuotaFailure accepts the statuses that mean no capacity is left', () => {
  assert.equal(isQuotaFailure(new OpenRouterHttpError(429, 'rate limited')), true);
  assert.equal(isQuotaFailure(new OpenRouterHttpError(402, 'insufficient credits')), true);
});

test('isQuotaFailure rejects a server fault and a bare error', () => {
  assert.equal(isQuotaFailure(new OpenRouterHttpError(500, 'upstream exploded')), false);
  assert.equal(isQuotaFailure(new Error('rate limited')), false);
  assert.equal(isQuotaFailure('rate limited'), false);
});

test('real client throws when the stream carries no content', async () => {
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: streaming([{ choices: [{ delta: {} }] }]),
  });
  await assert.rejects(
    () => client.complete({ model: 'm', messages: [], temperature: 0.7 }),
    /no content/,
  );
});

// The error text is stored in history/games.json, which is public, and is
// shown to the model that rewrites the lessons note. OpenRouter's error
// envelope carries the account's user_id, which belongs in neither.
test('a failed request reports the message without the account id', async () => {
  const body = JSON.stringify({
    error: { message: 'No endpoints found for a/model:free.', code: 404 },
    user_id: 'user_ExampleAccountIdNotARealOne',
  });
  const fetchImpl = (): Promise<Response> => Promise.resolve(new Response(body, { status: 404 }));
  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl });

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
  const fetchImpl = (): Promise<Response> =>
    Promise.resolve(new Response('x'.repeat(5_000), { status: 500 }));
  const client = createOpenRouterClient({ apiKey: 'test-key', fetchImpl });

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

// The deadlines are what turn a stalled provider into an ordinary failed
// attempt: generateDailyGame.ts already catches a rejection here, records
// `generation-call` and rotates the model. Without them the run reaches no
// failure path at all and dies at the workflow's 90-minute cap.
test('a completion that is never answered rejects', { timeout: 5_000 }, async () => {
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: neverAnswers,
    timeoutMs: 20,
    idleTimeoutMs: 20,
  });

  await assert.rejects(() => client.complete({ model: 'm', messages: [], temperature: 0.7 }));
});

// The failure the old total deadline could not name. The stream opens, a
// fragment arrives, and then nothing — with only an overall cap this waits
// out the full ten minutes before anyone notices.
test('a stream that goes quiet rejects on the idle deadline', { timeout: 5_000 }, async () => {
  const started = Date.now();
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: stallsMidStream,
    timeoutMs: 60_000,
    idleTimeoutMs: 50,
  });

  await assert.rejects(
    () => client.complete({ model: 'm', messages: [], temperature: 0.7 }),
    /nothing received for/,
  );
  assert.ok(Date.now() - started < 2_000, 'waited for the overall cap instead of the idle one');
});

// Moderation and reflection share this client with generation, whose default
// cap is sized for writing a whole game. Seven attempts inheriting it on both
// calls overruns the workflow's 90-minute cap, which is the one failure that
// records no history entry at all.
test(
  'a request-level cap ends the call before the client default',
  { timeout: 5_000 },
  async () => {
    const client = createOpenRouterClient({
      apiKey: 'test-key',
      // Steady enough that the idle clock never fires: only a deadline on the
      // whole request can stop this stream.
      fetchImpl: streamsSlowly(['tick ', 'tick ', 'tick ', 'tick '], 60),
      timeoutMs: 60_000,
      idleTimeoutMs: 5_000,
    });

    await assert.rejects(
      () => client.complete({ model: 'm', messages: [], temperature: 0.7, timeoutMs: 100 }),
      /gave up after/,
    );
  },
);

// A generation runs for minutes. If the idle clock were not restarted by the
// bytes arriving, it would fire partway through every honest answer.
test('a slow but steady stream outlives its idle deadline', { timeout: 10_000 }, async () => {
  const client = createOpenRouterClient({
    apiKey: 'test-key',
    fetchImpl: streamsSlowly(['slow ', 'but ', 'steady'], 60),
    timeoutMs: 10_000,
    idleTimeoutMs: 150,
  });
  const result = await client.complete({ model: 'm', messages: [], temperature: 0.7 });

  assert.equal(result.text, 'slow but steady');
});
