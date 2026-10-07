import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HistoryGameEntry } from '#actions_pipeline/lib/historyStore.ts';
import { EMPTY_SUMMARY } from '#actions_pipeline/lib/historyStore.ts';
import { GENRES } from '#actions_pipeline/lib/testFixtures.ts';
import { HISTORY, received, SUMMARY } from '#actions_pipeline/prompt/__tests__/fixtures.ts';
import { buildPrompt } from '#actions_pipeline/prompt/buildPrompt.ts';
import { DISPLAY_CONTRACT } from '#actions_pipeline/prompt/displayContract.ts';
import { stripAttemptFeedback } from '#lib/attemptFeedback.ts';

test('buildPrompt includes guardrails verbatim', () => {
  const guardrails = '- No humans at all.\n- No violence.';
  const prompt = buildPrompt({
    guardrailsText: guardrails,
    genres: GENRES,
    historyEntries: HISTORY,
    summary: SUMMARY,
  });
  assert.ok(prompt.includes(guardrails));
});

test('buildPrompt includes genres, history digest and lessons', () => {
  const prompt = buildPrompt({
    guardrailsText: 'rules',
    genres: GENRES,
    historyEntries: HISTORY,
    summary: SUMMARY,
  });
  assert.match(prompt, /maze-adventure \(Maze Adventure\)/);
  assert.match(prompt, /glass beetles/);
  assert.match(prompt, /Canvas resize handlers/);
});

test('buildPrompt omits optional sections when they are absent', () => {
  const prompt = buildPrompt({
    guardrailsText: 'rules',
    genres: GENRES,
    historyEntries: [],
    summary: { genreCounts: {}, genreLastUsed: {}, popularityLeaderboard: [], lessons: '' },
  });
  assert.doesNotMatch(prompt, /Lessons from past builds/);
  assert.doesNotMatch(prompt, /spiritual successor/);
  assert.doesNotMatch(prompt, /previous attempt failed/);
});

test('buildPrompt includes the remix suggestion when one is given', () => {
  const prompt = buildPrompt({
    guardrailsText: 'rules',
    genres: GENRES,
    historyEntries: HISTORY,
    summary: SUMMARY,
    remixSuggestion: SUMMARY.popularityLeaderboard[1] ?? null,
  });
  assert.match(prompt, /spiritual successor/);
  assert.match(prompt, /stone birds/);
});

test('buildPrompt feeds a prior failure reason back to the model', () => {
  const prompt = buildPrompt({
    guardrailsText: 'rules',
    genres: GENRES,
    historyEntries: HISTORY,
    summary: SUMMARY,
    priorFailureFeedback: 'you produced a JS error: foo is not defined',
  });
  assert.match(prompt, /previous attempt failed/);
  assert.match(prompt, /foo is not defined/);
});

test('buildPrompt is deterministic for identical inputs', () => {
  const params = {
    guardrailsText: 'rules',
    genres: GENRES,
    historyEntries: HISTORY,
    summary: SUMMARY,
  };
  assert.equal(buildPrompt(params), buildPrompt(params));
});

// Nothing outside the game's own document paints the frame, so a game that
// sizes itself to a fixed box leaves the rest of it blank.
test('buildPrompt tells the model how its game will be displayed', () => {
  const prompt = buildPrompt({
    guardrailsText: 'rules',
    genres: GENRES,
    historyEntries: HISTORY,
    summary: SUMMARY,
  });

  assert.ok(prompt.includes(DISPLAY_CONTRACT), 'display contract missing from the prompt');
});

test('buildPrompt carries the directives into the prompt', () => {
  const prompt = buildPrompt({
    guardrailsText: 'rules',
    genres: GENRES,
    historyEntries: [
      received('2026-08-29', { dislikeReasons: { 'no-load': 1 } }),
      received('2026-08-28', { dislikeReasons: { 'no-load': 1 } }),
    ],
    summary: SUMMARY,
  });

  assert.match(prompt, /Fix what has been going wrong/);
  assert.match(prompt, /not working at all/);
});

test('buildPrompt omits the directives section when nothing recurs', () => {
  const prompt = buildPrompt({
    guardrailsText: 'rules',
    genres: GENRES,
    historyEntries: [received('2026-08-29')],
    summary: SUMMARY,
  });

  assert.doesNotMatch(prompt, /Fix what has been going wrong/);
});

// The strongest guard on the pair: whatever wording `renderAttemptFeedback`
// emits, `stripAttemptFeedback` has to take back out exactly, leaving a
// prompt byte-identical to the one a first attempt would have been given.
// A heading edited on one side and not the other fails here.
test('stripping the attempt feedback restores a first-attempt prompt exactly', () => {
  const params = {
    guardrailsText: 'be nice',
    genres: GENRES,
    historyEntries: [] as HistoryGameEntry[],
    summary: EMPTY_SUMMARY,
  };
  const firstAttempt = buildPrompt(params);
  const retry = buildPrompt({
    ...params,
    priorFailureFeedback: 'Your previous game made a network request.',
  });

  assert.notEqual(retry, firstAttempt);
  assert.equal(stripAttemptFeedback(retry), firstAttempt);
});
