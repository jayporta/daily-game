import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeByokFailure } from '../byokFailure.ts';

test('a response cut off at the output cap says so, rather than blaming the format', () => {
  // The failure this whole module exists for: the model wrote a fine game and
  // was cut off before the closing fence, so extraction reports a missing html
  // block. Telling the visitor to try a different model is the wrong advice —
  // every model fails the same way against a cap that is too small.
  const report = describeByokFailure({
    source: 'response',
    stop: 'truncated',
    reason: 'missing-html-block',
  });

  assert.match(report.message, /ran out of room/i);
  assert.doesNotMatch(report.message, /different model/i);
});

test('a run cut off at the output cap is worth reporting — the cap is ours', () => {
  const report = describeByokFailure({
    source: 'response',
    stop: 'truncated',
    reason: 'missing-html-block',
  });

  assert.equal(report.worthReporting, true);
});

test('a model that ignored the output format is not worth reporting', () => {
  const report = describeByokFailure({
    source: 'response',
    stop: 'complete',
    reason: 'missing-html-block',
  });

  assert.equal(report.worthReporting, false);
  assert.match(report.message, /different model/i);
});

test('a rejected key is explained to the visitor and reported nowhere', () => {
  const report = describeByokFailure({
    source: 'request',
    kind: 'auth',
    message: 'openai request failed (401): invalid api key',
  });

  assert.equal(report.worthReporting, false);
  assert.match(report.message, /401/);
});

test('a provider fault is reported', () => {
  const report = describeByokFailure({
    source: 'request',
    kind: 'provider',
    message: 'openai request failed (500): upstream exploded',
  });

  assert.equal(report.worthReporting, true);
});

test('a truncated run tells the next attempt to leave room for the closing fence', () => {
  const report = describeByokFailure({
    source: 'response',
    stop: 'truncated',
    reason: 'missing-html-block',
  });

  assert.match(String(report.retryNote), /cut off/i);
});

test('a badly formatted response tells the next attempt which block was missing', () => {
  const report = describeByokFailure({
    source: 'response',
    stop: 'complete',
    reason: 'invalid-json-meta',
  });

  assert.match(String(report.retryNote), /valid JSON/i);
});

test('a failure the model cannot fix carries no corrective note', () => {
  // A rejected key is not something the next generation can do anything
  // about, and a note addressed to it would describe nothing.
  const report = describeByokFailure({
    source: 'request',
    kind: 'auth',
    message: 'openai request failed (401): invalid api key',
  });

  assert.equal(report.retryNote, undefined);
});

test('every failure carries a short cause label for tagging', () => {
  assert.equal(
    describeByokFailure({ source: 'request', kind: 'rate-limit', message: 'x' }).cause,
    'rate-limit',
  );
  assert.equal(
    describeByokFailure({ source: 'response', stop: 'truncated', reason: 'empty-html' }).cause,
    'truncated',
  );
  assert.equal(
    describeByokFailure({ source: 'response', stop: 'complete', reason: 'empty-html' }).cause,
    'empty-html',
  );
});
