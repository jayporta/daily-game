import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSseData } from '../sseStream.ts';

/** A streaming response that emits `chunks` exactly as given. */
function streamingResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function collect(response: Response): Promise<string[]> {
  const payloads: string[] = [];
  for await (const payload of readSseData(response)) payloads.push(payload);
  return payloads;
}

test('readSseData yields each frame payload in order', async () => {
  const payloads = await collect(streamingResponse(['data: one\n\ndata: two\n\ndata: three\n\n']));

  assert.deepEqual(payloads, ['one', 'two', 'three']);
});

// The whole point of streaming is that a payload arrives complete. A frame
// split mid-JSON must be buffered, not emitted as two broken halves.
test('readSseData rejoins a frame split across chunks', async () => {
  const payloads = await collect(streamingResponse(['data: {"te', 'xt":"hi"}\n\n']));

  assert.deepEqual(payloads, ['{"text":"hi"}']);
});

test('readSseData emits a final frame that never got a blank line', async () => {
  const payloads = await collect(streamingResponse(['data: one\n\ndata: last']));

  assert.deepEqual(payloads, ['one', 'last']);
});

// Anthropic prefixes each frame with an `event:` line, and some proxies
// inject `:` keep-alive comments.
test('readSseData ignores every line that is not data', async () => {
  const payloads = await collect(
    streamingResponse([': keep-alive\n\nevent: content_block_delta\ndata: {"a":1}\n\n']),
  );

  assert.deepEqual(payloads, ['{"a":1}']);
});

test('readSseData joins several data lines in one frame', async () => {
  const payloads = await collect(streamingResponse(['data: first\ndata: second\n\n']));

  assert.deepEqual(payloads, ['first\nsecond']);
});

test('readSseData handles carriage returns', async () => {
  const payloads = await collect(streamingResponse(['data: one\r\n\r\ndata: two\r\n\r\n']));

  assert.deepEqual(payloads, ['one', 'two']);
});

// A stub or an environment without a readable body must produce the same
// sequence, or the tests below it would be testing a path nothing runs.
test('readSseData reads a response that carries no stream body', async () => {
  const response = new Response('data: one\n\ndata: two\n\n', { status: 200 });
  Object.defineProperty(response, 'body', { value: null });

  assert.deepEqual(await collect(response), ['one', 'two']);
});

// A consumer that stops early — the sentinel, or an error frame — must not
// leave the rest of the body unread with the connection still open.
test('readSseData closes the body when the consumer stops early', async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: one\n\ndata: two\n\n'));
    },
    cancel() {
      cancelled = true;
    },
  });

  for await (const payload of readSseData(new Response(body, { status: 200 }))) {
    assert.equal(payload, 'one');
    break;
  }

  // Cancellation is asynchronous; let it settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});
