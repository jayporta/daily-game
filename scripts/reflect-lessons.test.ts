import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reflectLessons, rewriteLessons } from './reflect-lessons.ts';
import { buildLessonsMessages, isLessonsRequest } from './lib/lessons-prompt.ts';
import { EMPTY_SUMMARY } from './lib/history-store.ts';
import { createMockOpenRouterClient } from './lib/openrouter-client.mock.ts';
import { loadFixture } from './lib/fixtures.ts';
import type { OpenRouterClient } from './lib/openrouter-client.ts';
import type { HistoryGameEntry, HistorySummary } from './lib/types.ts';

const NOW = new Date('2026-08-30T12:00:00.000Z');

/** A published entry `daysAgo` days before the frozen clock. */
function published(daysAgo: number, over: Partial<HistoryGameEntry> = {}): HistoryGameEntry {
  const date = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return {
    date,
    status: 'published',
    model: 'a/model:free',
    slug: `${date}-game`,
    genre: 'puzzle',
    theme: 'glass beetles',
    mechanics: ['move'],
    title: 'A Game',
    ...over,
  };
}

function scratchRepo(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-reflect-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'history'), { recursive: true });
  return dir;
}

/** Seeds a hot window and a summary carrying `lessons`. */
function seed(root: string, entries: HistoryGameEntry[], lessons = ''): void {
  writeFileSync(join(root, 'history', 'games.json'), `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  const summary: HistorySummary = { ...EMPTY_SUMMARY, lessons };
  writeFileSync(join(root, 'history', 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function readLessons(root: string): string {
  return JSON.parse(readFileSync(join(root, 'history', 'summary.json'), 'utf8')).lessons;
}

function stubClient(reply: string): OpenRouterClient {
  return { async complete() { return reply; } };
}

const throwingClient: OpenRouterClient = {
  async complete() { throw new Error('rate limited'); },
};

test('buildLessonsMessages shows the model the ageing games', () => {
  const messages = buildLessonsMessages(
    { ...EMPTY_SUMMARY, lessons: 'canvas resizes drift' },
    [published(50, { theme: 'tide clocks' })],
  );
  const prompt = messages.map((message) => message.content).join('\n');

  assert.match(prompt, /tide clocks/);
  assert.match(prompt, /canvas resizes drift/);
});

// The reason the field exists: a recurring failure can only become a lesson
// if the model rewriting the lessons is shown it.
test('buildLessonsMessages shows the model why past runs failed', () => {
  const failed: HistoryGameEntry = {
    date: '2026-05-01',
    status: 'failed_kept_previous',
    model: 'a/model:free',
    attempts: 3,
    failureReasons: ['attempt 1: canvas resize dropped every entity'],
  };

  const prompt = buildLessonsMessages(EMPTY_SUMMARY, [failed])
    .map((message) => message.content)
    .join('\n');

  assert.match(prompt, /canvas resize dropped every entity/);
});

test('rewriteLessons returns the model prose', async () => {
  const lessons = await rewriteLessons(stubClient('  Guard every lookup.  '), {
    model: 'mod',
    summary: EMPTY_SUMMARY,
    aging: [published(50)],
  });

  assert.equal(lessons, 'Guard every lookup.');
});

// A stale note costs the next prompt some polish; an unbounded hot window
// costs every prompt thereafter.
test('rewriteLessons returns null when the model is unreachable', async () => {
  const lessons = await rewriteLessons(throwingClient, {
    model: 'mod',
    summary: EMPTY_SUMMARY,
    aging: [published(50)],
  });

  assert.equal(lessons, null);
});

test('rewriteLessons returns null for an empty answer', async () => {
  const lessons = await rewriteLessons(stubClient('   '), {
    model: 'mod',
    summary: EMPTY_SUMMARY,
    aging: [published(50)],
  });

  assert.equal(lessons, null);
});

test('rewriteLessons bounds a runaway answer', async () => {
  const lessons = await rewriteLessons(stubClient('x'.repeat(10_000)), {
    model: 'mod',
    summary: EMPTY_SUMMARY,
    aging: [published(50)],
  });

  assert.equal(lessons?.length, 4_000);
});

// Without this the mock answers a reflection call with a generation fixture,
// and a whole game bundle lands in summary.json as the note every later
// prompt reads. `generate:local` runs exactly this path.
test('the mock client answers a reflection call with prose, not a game', async (t) => {
  const root = scratchRepo(t);
  seed(root, [published(1)]);

  await reflectLessons({
    root,
    model: 'mod/model:free',
    client: createMockOpenRouterClient({ fixtureSequence: [loadFixture('good-maze')] }),
  });

  const lessons = readLessons(root);
  assert.doesNotMatch(lessons, /```/, 'a fenced block reached the lessons note');
  assert.doesNotMatch(lessons, /<!doctype html>/i);
});

test('isLessonsRequest tells a reflection call from a generation call', () => {
  const reflection = buildLessonsMessages(EMPTY_SUMMARY, [published(1)]);

  assert.equal(isLessonsRequest(reflection), true);
  assert.equal(isLessonsRequest([{ role: 'user', content: 'build a game' }]), false);
});

test('reflectLessons rewrites the note from the hot window', async (t) => {
  const root = scratchRepo(t);
  seed(root, [published(1), published(2)], 'old wisdom');

  const result = await reflectLessons({
    root,
    client: stubClient('Guard every lookup.'),
    model: 'mod/model:free',
  });

  assert.equal(result.rewritten, true);
  assert.equal(readLessons(root), 'Guard every lookup.');
});

// A stale note costs tomorrow's prompt some polish. Failing here must never
// cost the day its game.
test('reflectLessons keeps the old note when the model is unreachable', async (t) => {
  const root = scratchRepo(t);
  seed(root, [published(1)], 'old wisdom');

  const result = await reflectLessons({ root, client: throwingClient, model: 'mod/model:free' });

  assert.equal(result.rewritten, false);
  assert.equal(readLessons(root), 'old wisdom');
});

test('reflectLessons writes nothing when there is no history yet', async (t) => {
  const root = scratchRepo(t);
  seed(root, [], 'old wisdom');

  const result = await reflectLessons({ root, client: stubClient('new'), model: 'mod/model:free' });

  assert.equal(result.rewritten, false);
  assert.equal(readLessons(root), 'old wisdom');
});

test('reflectLessons writes nothing on a dry run', async (t) => {
  const root = scratchRepo(t);
  seed(root, [published(1)], 'old wisdom');

  const result = await reflectLessons({
    root,
    dryRun: true,
    client: stubClient('Guard every lookup.'),
    model: 'mod/model:free',
  });

  assert.equal(result.rewritten, true);
  assert.equal(readLessons(root), 'old wisdom');
});

// The whole point of moving this off the rollup: the note reflects the hot
// window, so a lesson reaches the prompt the next day rather than in two
// months' time.
test('reflectLessons distils the recent window, not aged-out games', async (t) => {
  const root = scratchRepo(t);
  seed(root, [published(1, { theme: 'yesterday tide clocks' })]);
  let seen = '';

  await reflectLessons({
    root,
    model: 'mod/model:free',
    client: {
      async complete({ messages }) {
        seen = messages.map((message) => message.content).join('\n');
        return 'Guard every lookup.';
      },
    },
  });

  assert.match(seen, /yesterday tide clocks/);
});
