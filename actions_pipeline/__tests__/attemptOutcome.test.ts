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
  renderedSomething: false,
  active: false,
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
      reasons: ['the page never changed'],
    },
    false,
  );
  const feedback = rejection.feedback ?? '';

  assert.equal(rejection.kind, 'smoke-inert');
  assert.match(feedback, /complete game script/);
  assert.match(feedback, /never changed/);
});
