import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyStopReason,
  firstChoiceContent,
  firstChoiceFinishReason,
} from '#lib/provider-response.ts';

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
test('firstChoiceContent and firstChoiceFinishReason read the same response', () => {
  const data = { choices: [{ message: { content: 'partial doc' }, finish_reason: 'length' }] };
  assert.equal(firstChoiceContent(data), 'partial doc');
  assert.equal(classifyStopReason(firstChoiceFinishReason(data)), 'truncated');
});
