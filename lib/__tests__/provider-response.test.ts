import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyStopReason,
  firstChoiceDelta,
  firstChoiceFinishReason,
  streamedError,
  streamedFrames,
} from '#lib/provider-response.ts';
import { sseResponse } from '#scripts/lib/testFixtures.ts';

/** Every frame a stream yields, drained. */
async function drain(response: Response): Promise<unknown[]> {
  const frames: unknown[] = [];
  for await (const frame of streamedFrames(response)) frames.push(frame);
  return frames;
}

test('firstChoiceFinishReason reads choices[0].finish_reason', () => {
  const data = { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] };
  assert.equal(firstChoiceFinishReason(data), 'stop');
});

test('firstChoiceFinishReason is null when the field is absent', () => {
  assert.equal(firstChoiceFinishReason({ choices: [{}] }), null);
  assert.equal(firstChoiceFinishReason({}), null);
});

test('classifyStopReason recognises every truncation spelling', () => {
  for (const raw of ['length', 'max_tokens', 'model_length', 'LENGTH']) {
    assert.equal(classifyStopReason(raw), 'truncated', `${raw} should classify as truncated`);
  }
});

test('classifyStopReason recognises every refusal spelling', () => {
  for (const raw of ['content_filter', 'refusal', 'safety', 'SAFETY']) {
    assert.equal(classifyStopReason(raw), 'refused', `${raw} should classify as refused`);
  }
});

test('classifyStopReason treats an unrecognised token as complete', () => {
  assert.equal(classifyStopReason('stop'), 'complete');
});

test('classifyStopReason returns null for no stop field, not a guess', () => {
  assert.equal(classifyStopReason(null), null);
});

// Confirms the two reads share the same envelope rather than disagreeing on it.
test('firstChoiceDelta and firstChoiceFinishReason read the same frame', () => {
  const frame = { choices: [{ delta: { content: 'partial doc' }, finish_reason: 'length' }] };
  assert.equal(firstChoiceDelta(frame), 'partial doc');
  assert.equal(classifyStopReason(firstChoiceFinishReason(frame)), 'truncated');
});

test('streamedFrames parses each frame in order', async () => {
  const frames = await drain(sseResponse([{ n: 1 }, { n: 2 }]));

  assert.deepEqual(frames, [{ n: 1 }, { n: 2 }]);
});

// Providers pad streams with keep-alives, so one unparseable frame ends
// nothing; the callers report a stream made entirely of them instead.
test('streamedFrames skips a frame that is not JSON', async () => {
  const frames = await drain(sseResponse(['not json at all', { n: 2 }]));

  assert.deepEqual(frames, [{ n: 2 }]);
});

// OpenRouter sends usage accounting after the sentinel. Reading past it would
// hand the callers a frame carrying no choices, which reads as an empty answer.
test('streamedFrames stops at the sentinel', async () => {
  const body = 'data: {"n":1}\n\ndata: [DONE]\n\ndata: {"n":2}\n\n';
  const response = new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

  assert.deepEqual(await drain(response), [{ n: 1 }]);
});

test('streamedError reads the status out of an envelope that carries one', () => {
  assert.deepEqual(streamedError({ error: { message: 'rate limited', code: 429 } }), {
    message: 'rate limited',
    status: 429,
  });
});

test('streamedError reports no status when the envelope carries none', () => {
  assert.deepEqual(streamedError({ error: 'plain string failure' }), {
    message: 'plain string failure',
    status: null,
  });
});

test('streamedError returns null for an ordinary frame', () => {
  assert.equal(streamedError({ choices: [{ delta: { content: 'hi' } }] }), null);
});
