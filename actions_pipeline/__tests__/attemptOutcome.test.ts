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
  loaded: true,
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
    { ...BLANK_PAGE, loaded: false, reasons: ['page failed to load: boom'] },
    false,
  );

  assert.equal(rejection.kind, 'smoke-load');
  assert.match(rejection.feedback ?? '', /failed to load/);
});

test('a page that loaded but rendered nothing is still smoke-blank', () => {
  const rejection = smokeRejection({ ...BLANK_PAGE, loaded: true }, false);

  assert.equal(rejection.kind, 'smoke-blank');
});

test('a script error on a page that never loaded stays smoke-js-error', () => {
  const rejection = smokeRejection(
    { ...BLANK_PAGE, loaded: false, reasons: ['boom'], pageErrors: ['boom'] },
    false,
  );

  assert.equal(rejection.kind, 'smoke-js-error');
});

test('a page that rendered but whose probe threw falls through to smoke-load', () => {
  const rejection = smokeRejection(
    {
      ...BLANK_PAGE,
      renderedSomething: true,
      reasons: ['page loaded but could not be inspected: crashed'],
    },
    false,
  );

  assert.equal(rejection.kind, 'smoke-load');
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
