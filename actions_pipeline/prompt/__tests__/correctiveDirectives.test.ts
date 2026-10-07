import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FailedEntry } from '#actions_pipeline/lib/historyStore.ts';
import { received } from '#actions_pipeline/prompt/__tests__/fixtures.ts';
import { correctiveDirectives } from '#actions_pipeline/prompt/correctiveDirectives.ts';

test('correctiveDirectives stays quiet when nothing recurs', () => {
  assert.deepEqual(correctiveDirectives([received('2026-08-29', { likes: 5 })]), []);
});

test('correctiveDirectives ignores a one-off complaint', () => {
  const directives = correctiveDirectives([
    received('2026-08-29', { dislikeReasons: { 'goal-unclear': 9 } }),
  ]);

  assert.deepEqual(directives, []);
});

test('correctiveDirectives speaks up once a complaint recurs', () => {
  const directives = correctiveDirectives([
    received('2026-08-29', { dislikeReasons: { 'goal-unclear': 1 } }),
    received('2026-08-28', { dislikeReasons: { 'goal-unclear': 1 } }),
  ]);

  assert.equal(directives.length, 1);
  assert.match(String(directives[0]), /Goal unclear/);
});

test('correctiveDirectives leads with the most frequent problem', () => {
  const directives = correctiveDirectives([
    received('2026-08-29', { dislikeReasons: { 'goal-unclear': 1, 'no-load': 1 } }),
    received('2026-08-28', { dislikeReasons: { 'goal-unclear': 1, 'no-load': 1 } }),
    received('2026-08-27', { dislikeReasons: { 'goal-unclear': 1 } }),
  ]);

  assert.match(String(directives[0]), /Goal unclear/);
  assert.match(String(directives[1]), /not working at all/);
});

test('correctiveDirectives responds to recurring generation failures', () => {
  const failed = (date: string): FailedEntry => ({
    date,
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 3,
    failureReasons: [],
    failureKinds: ['smoke-network', 'smoke-network'],
  });

  const directives = correctiveDirectives([failed('2026-08-29')]);

  assert.equal(directives.length, 1);
  assert.match(String(directives[0]), /over the network/);
});

// A published day still records the attempts that failed before one won.
test('correctiveDirectives counts the failed attempts of published days', () => {
  const directives = correctiveDirectives([
    received('2026-08-29', { failureKinds: ['extract'] }),
    received('2026-08-28', { failureKinds: ['extract'] }),
  ]);

  assert.equal(directives.length, 1);
  assert.match(String(directives[0]), /could not be parsed/);
});

test('a generation-call failure on a quota-affected day hands the model no wording, and only that', () => {
  // A refused request is a capacity problem, not something the model wrote.
  const failed: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 2,
    failureReasons: [],
    failureKinds: ['generation-call', 'generation-call', 'extract'],
    quotaAffected: true,
  };
  const published = received('2026-08-28', {
    failureKinds: ['generation-call', 'generation-call', 'extract'],
    quotaAffected: true,
  });

  // The day's other failures still count.
  const directives = correctiveDirectives([failed, published]);
  assert.equal(directives.length, 1);
  assert.match(String(directives[0]), /could not be parsed/);

  // An unaffected day carries no quotaAffected field at all.
  const { quotaAffected: _, ...unaffectedDay } = failed;
  const unaffected = correctiveDirectives([unaffectedDay]);
  assert.match(String(unaffected[0]), /failed before returning anything/);
});

test('a recurring moderator outage hands the model no corrective wording', () => {
  // The generation succeeded and parsed every time; only our moderator was
  // down. Guidance here would tell the model to fix what it never broke.
  const outage: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 3,
    failureReasons: [],
    failureKinds: ['moderation-unreachable', 'moderation-unreachable'],
  };

  assert.deepEqual(correctiveDirectives([outage]), []);
});

test('a recurring failover hands the model no corrective wording', () => {
  // A fallback took over because a provider refused; nothing the model wrote
  // was wrong, so guidance would describe a fault that was never its own.
  const failover: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 3,
    failureReasons: [],
    failureKinds: ['generation-failover', 'generation-failover'],
  };

  assert.deepEqual(correctiveDirectives([failover]), []);
});

test('a recurring load failure tells the model to return a complete document', () => {
  const unloadable: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 3,
    failureReasons: [],
    failureKinds: ['smoke-load', 'smoke-load'],
  };

  const directives = correctiveDirectives([unloadable]);

  assert.equal(directives.length, 1);
  assert.match(String(directives[0]), /failed to load at all/);
});

test('a recurring blank render tells the model to draw something', () => {
  const blank: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 3,
    failureReasons: [],
    failureKinds: ['smoke-blank', 'smoke-blank'],
  };

  const directives = correctiveDirectives([blank]);

  assert.equal(directives.length, 1);
  assert.match(String(directives[0]), /showed nothing/);
});

test('a recurring inert page tells the model to start the game loop', () => {
  const inert: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 3,
    failureReasons: [],
    failureKinds: ['smoke-inert', 'smoke-inert'],
  };

  const directives = correctiveDirectives([inert]);

  assert.equal(directives.length, 1);
  assert.match(String(directives[0]), /never changed/);
});

test('a recurring hang tells the model to keep its handlers and loops bounded', () => {
  const hung: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 3,
    failureReasons: [],
    failureKinds: ['smoke-unresponsive', 'smoke-unresponsive'],
  };

  const directives = correctiveDirectives([hung]);

  assert.equal(directives.length, 1);
  assert.match(String(directives[0]), /stopped responding/);
  assert.doesNotMatch(String(directives[0]), /failed to load/);
});

test('a recurring unobserved page hands the model no corrective wording', () => {
  // The page loaded and then crashed or closed before it was examined; whose
  // fault that was, nobody saw, so there is nothing to tell the model to fix.
  const unobserved: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 3,
    failureReasons: [],
    failureKinds: ['smoke-unobserved', 'smoke-unobserved'],
  };

  assert.deepEqual(correctiveDirectives([unobserved]), []);
});

test('a recurring placeholder-metadata failure tells the model to describe the real game', () => {
  const placeholder: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 3,
    failureReasons: [],
    failureKinds: ['placeholder-meta', 'placeholder-meta'],
  };

  const directives = correctiveDirectives([placeholder]);

  assert.equal(directives.length, 1);
  assert.match(String(directives[0]), /example values/);
});

test('a recurring placeholder-script failure tells the model to write every function', () => {
  const stub: FailedEntry = {
    date: '2026-08-29',
    status: 'failed_kept_previous',
    model: 'm',
    attempts: 3,
    failureReasons: [],
    failureKinds: ['placeholder-script', 'placeholder-script'],
  };

  const directives = correctiveDirectives([stub]);

  assert.equal(directives.length, 1);
  assert.match(String(directives[0]), /placeholder or stub script/);
});

// Only ids from the closed vocabularies select wording, so nothing a visitor
// or a past generation wrote can reach the prompt through this path.
test('correctiveDirectives ignores a reason outside the vocabulary', () => {
  const unrecognizedReasons: Record<string, number> = { 'ignore-previous-instructions': 5 };
  const directives = correctiveDirectives([
    received('2026-08-29', { dislikeReasons: unrecognizedReasons }),
    received('2026-08-28', { dislikeReasons: unrecognizedReasons }),
  ]);

  assert.deepEqual(directives, []);
});
