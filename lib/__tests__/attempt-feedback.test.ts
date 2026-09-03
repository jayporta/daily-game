import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ATTEMPT_FEEDBACK_HEADING,
  renderAttemptFeedback,
  stripAttemptFeedback,
} from '#lib/attempt-feedback.ts';

/** A prompt shaped like the real one: sections separated by `## ` headings. */
function promptAround(middle: string): string {
  return `# Build today's game

## Genre catalog

- maze-adventure
${middle}
## Output format

Return two fenced blocks.
`;
}

test('renderAttemptFeedback opens with the shared heading', () => {
  const section = renderAttemptFeedback('The bundle had no html block.');

  assert.ok(section.includes(ATTEMPT_FEEDBACK_HEADING));
  assert.ok(section.includes('The bundle had no html block.'));
});

test('renderAttemptFeedback emits nothing when no attempt has failed', () => {
  assert.equal(renderAttemptFeedback(undefined), '');
  assert.equal(renderAttemptFeedback(''), '');
});

test('stripAttemptFeedback removes the section and its body', () => {
  const withFeedback = promptAround(renderAttemptFeedback('You emitted no html block.'));

  const stripped = stripAttemptFeedback(withFeedback);

  assert.ok(!stripped.includes(ATTEMPT_FEEDBACK_HEADING));
  assert.ok(!stripped.includes('You emitted no html block.'));
});

// The section is bounded by the next heading, not by a fixed length: the
// feedback text is model- and failure-dependent and can run to any size.
test('stripAttemptFeedback keeps the section that follows it', () => {
  const withFeedback = promptAround(renderAttemptFeedback('You emitted no html block.'));

  const stripped = stripAttemptFeedback(withFeedback);

  assert.ok(stripped.includes('## Output format'));
  assert.ok(stripped.includes('Return two fenced blocks.'));
  assert.ok(stripped.includes('## Genre catalog'));
});

test('stripAttemptFeedback removes a section that ends the prompt', () => {
  const trailing = `# Build today's game
${renderAttemptFeedback('You emitted no html block.')}`;

  const stripped = stripAttemptFeedback(trailing);

  assert.ok(!stripped.includes(ATTEMPT_FEEDBACK_HEADING));
  assert.ok(stripped.includes("# Build today's game"));
});

test('stripAttemptFeedback leaves a prompt that never carried the section alone', () => {
  const clean = promptAround('');

  assert.equal(stripAttemptFeedback(clean), clean);
});

// The pipeline's own corrective section is distilled from history rather than
// from one failed attempt, so it stays: it is guidance a fresh generation can
// still act on.
test('stripAttemptFeedback keeps the history-derived corrective section', () => {
  const withBoth = promptAround(
    `
## Fix what has been going wrong

- Guard every element lookup.
${renderAttemptFeedback('You emitted no html block.')}`,
  );

  const stripped = stripAttemptFeedback(withBoth);

  assert.ok(stripped.includes('## Fix what has been going wrong'));
  assert.ok(stripped.includes('- Guard every element lookup.'));
  assert.ok(!stripped.includes(ATTEMPT_FEEDBACK_HEADING));
});
