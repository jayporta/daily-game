// Reading a `text/event-stream` response, one `data:` payload at a time.
//
// Protocol mechanics only — nothing here knows what a provider puts inside a
// payload. Kept beside providers.ts rather than inside it so the framing
// rules can be tested against split chunks without standing up a provider.

/** Frames are separated by a blank line; \r\n survives some proxies. */
const FRAME_SEPARATOR = /\r?\n\r?\n/;

/**
 * The payloads of an SSE response, in order.
 *
 * Yields the `data:` content of each frame, with a frame's several `data:`
 * lines joined by newlines as the spec requires. Non-`data:` lines — `event:`,
 * `id:`, `:` comments — are ignored: every provider here carries everything
 * that matters in the payload, and Anthropic's event type is repeated inside
 * its own JSON.
 *
 * Reads the body incrementally when there is one, which is what makes the
 * output appear as it is generated. A response with no readable body (a stub,
 * or an environment without streaming) is read whole and framed identically,
 * so callers get the same sequence either way.
 *
 * @param response A response already checked for `ok`.
 */
export async function* readSseData(response: Response): AsyncGenerator<string> {
  for await (const chunk of bodyChunks(response)) {
    yield* chunk;
  }
}

/**
 * Decoded frames, buffered across chunk boundaries.
 *
 * Pulled with an explicit reader rather than `for await` over the body:
 * async iteration of a `ReadableStream` is still missing in Safari, and the
 * DOM types do not declare it either, so iterating would need a cast to
 * describe something not every browser has.
 */
async function* bodyChunks(response: Response): AsyncGenerator<string[]> {
  const body = response.body;
  if (body === null) {
    yield framePayloads(await response.text(), true).payloads;
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { payloads, rest } = framePayloads(buffer, false);
      buffer = rest;
      if (payloads.length > 0) yield payloads;
    }
  } finally {
    // Cancelled, not merely released: a consumer that stops early — at the
    // end-of-stream sentinel, or on an error frame — leaves the rest of the
    // body unread, and releasing the lock alone would hold the connection
    // open on it. Cancelling a stream already drained is a no-op.
    //
    // The rejection is swallowed deliberately: cancelling a stream that has
    // already failed rejects with that same failure, which the caller has
    // turned into its own error, and an unhandled one here would crash the
    // page over a connection that is being closed anyway.
    void reader.cancel().catch(() => undefined);
  }

  buffer += decoder.decode();
  const { payloads } = framePayloads(buffer, true);
  if (payloads.length > 0) yield payloads;
}

/**
 * Splits buffered text into complete frames.
 *
 * @param last Whether the stream has ended. Until it has, the text after the
 *   final separator is an incomplete frame and is carried forward — emitting
 *   it early would cut a JSON payload in half.
 */
function framePayloads(buffer: string, last: boolean): { payloads: string[]; rest: string } {
  const frames = buffer.split(FRAME_SEPARATOR);
  const rest = last ? '' : (frames.pop() ?? '');
  const payloads: string[] = [];

  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n');
    if (data.length > 0) payloads.push(data);
  }
  return { payloads, rest };
}
