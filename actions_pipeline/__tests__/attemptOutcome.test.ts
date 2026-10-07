import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smokeRejection } from '#actions_pipeline/attemptOutcome.ts';
import type { SmokeTestResult } from '#actions_pipeline/smokeTest.ts';

const BLANK_PAGE: SmokeTestResult = {
  pass: false,
  reasons: ['page rendered nothing'],
  warnings: [],
  consoleErrors: [],
  pageErrors: [],
  networkAttempts: [],
  canvasDrawn: false,
  reach: 'observed',
  renderedSomething: false,
  activity: null,
};

test('a blank-page rejection tells the model to write the complete game script', () => {
  const rejection = smokeRejection(BLANK_PAGE, false);
  const feedback = rejection.feedback ?? '';

  assert.equal(rejection.kind, 'smoke-blank');
  assert.match(feedback, /complete game script/);
  assert.match(feedback, /page rendered nothing/);
});

test('a script-error rejection keeps the defensive-coding feedback', () => {
  const rejection = smokeRejection(
    { ...BLANK_PAGE, reasons: ['boom'], pageErrors: ['boom'] },
    false,
  );
  const feedback = rejection.feedback ?? '';

  assert.equal(rejection.kind, 'smoke-js-error');
  assert.match(feedback, /Be more defensive/);
  assert.doesNotMatch(feedback, /complete game script/);
});

test('an inert-page rejection is smoke-inert and asks for the complete game script', () => {
  const rejection = smokeRejection(
    {
      ...BLANK_PAGE,
      renderedSomething: true,
      activity: 'inert',
      reasons: ['the page never changed'],
    },
    false,
  );
  const feedback = rejection.feedback ?? '';

  assert.equal(rejection.kind, 'smoke-inert');
  assert.match(feedback, /complete game script/);
  assert.match(feedback, /never changed/);
});

test('a page that never loaded is smoke-load, not smoke-blank', () => {
  const rejection = smokeRejection(
    { ...BLANK_PAGE, reach: 'not-loaded', reasons: ['page failed to load: boom'] },
    false,
  );

  assert.equal(rejection.kind, 'smoke-load');
  assert.match(rejection.feedback ?? '', /failed to load/);
});

test('a script error on a page that never loaded stays smoke-js-error', () => {
  const rejection = smokeRejection(
    { ...BLANK_PAGE, reach: 'not-loaded', reasons: ['boom'], pageErrors: ['boom'] },
    false,
  );

  assert.equal(rejection.kind, 'smoke-js-error');
});

test('a page that loaded but could not be observed is smoke-unobserved and hands the model no feedback', () => {
  // Nothing was seen, so no fixed guidance fits; the reason is recorded for humans.
  const rejection = smokeRejection(
    {
      ...BLANK_PAGE,
      reach: 'unobserved',
      reasons: ['page loaded but could not be observed: crashed'],
    },
    false,
  );

  assert.equal(rejection.kind, 'smoke-unobserved');
  assert.match(rejection.reason, /could not be observed/);
  assert.equal(rejection.feedback, undefined);
});

test('a page that hung before it was read is smoke-unresponsive, not smoke-blank', () => {
  // Its render fields are false only because the read never answered.
  const rejection = smokeRejection(
    { ...BLANK_PAGE, activity: 'unresponsive', reasons: ['the page stopped responding'] },
    false,
  );

  assert.equal(rejection.kind, 'smoke-unresponsive');
});

test('a page that stopped responding is smoke-unresponsive and asks for bounded handlers', () => {
  const rejection = smokeRejection(
    {
      ...BLANK_PAGE,
      renderedSomething: true,
      activity: 'unresponsive',
      reasons: ['the page stopped responding to input'],
    },
    false,
  );
  const feedback = rejection.feedback ?? '';

  assert.equal(rejection.kind, 'smoke-unresponsive');
  assert.match(feedback, /stopped responding/);
  assert.match(feedback, /bounded/);
  assert.doesNotMatch(feedback, /complete game script/);
  assert.doesNotMatch(feedback, /Be more defensive/);
});
