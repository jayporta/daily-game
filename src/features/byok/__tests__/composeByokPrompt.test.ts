import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeByokPrompt } from '../composeByokPrompt.ts';
import { ATTEMPT_FEEDBACK_HEADING } from '../../../../lib/attempt-feedback.ts';

const BASE = 'Build a game.\n\nReturn EXACTLY two fenced code blocks.';

test('adds nothing when there is nothing to add', () => {
  // The panel shows the composed prompt under "See the exact prompt this will
  // send", so an untouched run must show the archived prompt byte for byte.
  assert.equal(composeByokPrompt({ basePrompt: BASE }), BASE);
});

test('carries a previous attempt’s correction under the shared heading', () => {
  const composed = composeByokPrompt({
    basePrompt: BASE,
    priorFailureFeedback: 'Your response was cut off.',
  });

  assert.ok(composed.startsWith(BASE));
  assert.match(composed, new RegExp(ATTEMPT_FEEDBACK_HEADING.replace('—', '\\u2014')));
  assert.match(composed, /Your response was cut off\./);
});

test('includes the current game in a fenced block the model can read', () => {
  const composed = composeByokPrompt({
    basePrompt: BASE,
    currentGameHtml: '<!doctype html><body>the game</body>',
  });

  assert.match(composed, /```html\n<!doctype html><body>the game<\/body>\n```/);
});

test('says what the included game is for', () => {
  const composed = composeByokPrompt({
    basePrompt: BASE,
    currentGameHtml: '<!doctype html>',
  });

  assert.match(composed, /improve/i);
});

test('carries both additions when both apply', () => {
  const composed = composeByokPrompt({
    basePrompt: BASE,
    priorFailureFeedback: 'Your response was cut off.',
    currentGameHtml: '<!doctype html><body>the game</body>',
  });

  assert.match(composed, /Your response was cut off\./);
  assert.match(composed, /the game<\/body>/);
});

test('restates the output format after anything that follows it', () => {
  // The archived prompt ends with the two-block contract. Both additions are
  // appended after it, so without this the last thing the model reads is a
  // fenced block of somebody else's HTML.
  const composed = composeByokPrompt({
    basePrompt: BASE,
    currentGameHtml: '<!doctype html>',
  });

  assert.match(composed.slice(composed.lastIndexOf('```')), /two fenced/i);
});

test('an empty game or an empty note adds nothing', () => {
  assert.equal(composeByokPrompt({ basePrompt: BASE, currentGameHtml: '' }), BASE);
  assert.equal(composeByokPrompt({ basePrompt: BASE, priorFailureFeedback: '' }), BASE);
});

test('tells the model not to copy the site’s own additions to the bundle', () => {
  // A published bundle carries publish.ts's CSP meta and error-reporting
  // snippet. A BYOK result never goes through publish.ts, so a model that
  // copied the snippet would report a visitor's own game under the published
  // game's slug — to our Sentry, which index.html's CSP permits.
  const composed = composeByokPrompt({
    basePrompt: BASE,
    currentGameHtml: '<!doctype html><head><meta http-equiv="Content-Security-Policy"></head>',
  });

  assert.match(composed, /Content-Security-Policy/);
  assert.match(composed, /Leave them out of your answer/);
});
