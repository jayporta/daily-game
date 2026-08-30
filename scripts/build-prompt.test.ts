import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DISPLAY_CONTRACT,
  OUTPUT_FORMAT_CONTRACT,
  buildPrompt,
  correctiveDirectives,
  digestHistory,
  formatGenreCatalog,
  recentlyUsedGenreIds,
  selectRemixSuggestion,
} from './build-prompt.ts';
import { extractBundle } from '../lib/extract-bundle-shared.ts';
import { GENRES } from './lib/fixtures.ts';
import type { HistoryGameEntry, HistorySummary } from './lib/types.ts';

const HISTORY: HistoryGameEntry[] = [
  {
    date: '2026-08-27',
    status: 'published',
    model: 'a/model:free',
    slug: '2026-08-27-old-one',
    genre: 'puzzle',
    theme: 'floating lanterns',
    mechanics: ['drag', 'match'],
  },
  {
    date: '2026-08-28',
    status: 'published',
    model: 'b/model:free',
    slug: '2026-08-28-newer-one',
    genre: 'maze-adventure',
    theme: 'glass beetles',
    mechanics: ['move', 'collect'],
  },
  { date: '2026-08-26', status: 'failed_kept_previous', model: 'c/model:free' },
];

const SUMMARY: HistorySummary = {
  genreCounts: { puzzle: 3 },
  genreLastUsed: { puzzle: '2026-08-27' },
  popularityLeaderboard: [
    { slug: '2026-08-01-tide-garden', theme: 'tide clocks', mechanicsSummary: 'grow, wait', popularityScore: 41 },
    { slug: '2026-07-02-old-favourite', theme: 'stone birds', mechanicsSummary: 'glide', popularityScore: 90 },
  ],
  lessons: 'Canvas resize handlers often forget to rescale entity positions.',
};

const NOW = new Date('2026-08-29T12:00:00Z');

test('digestHistory lists every recent day, newest first', () => {
  const digest = digestHistory(HISTORY);
  const lines = digest.split('\n');

  assert.equal(lines.length, 3);
  assert.match(lines[0] as string, /2026-08-28/);
  assert.match(lines[1] as string, /2026-08-27/);
  assert.match(lines[2] as string, /2026-08-26/);
});

// Genres are only ever chosen by a published game, so a failed day must not
// mark one as recently used.
test('recentlyUsedGenreIds still ignores failed days', () => {
  assert.deepEqual(recentlyUsedGenreIds(HISTORY), ['maze-adventure', 'puzzle']);
});

test('digestHistory respects its limit', () => {
  assert.equal(digestHistory(HISTORY, 1).split('\n').length, 1);
});

test('digestHistory explains the empty case rather than emitting nothing', () => {
  assert.match(digestHistory([]), /very first one/);
});

test('recentlyUsedGenreIds dedupes and ignores failed entries', () => {
  assert.deepEqual(recentlyUsedGenreIds(HISTORY), ['maze-adventure', 'puzzle']);
});

test('formatGenreCatalog marks recently used genres for avoidance', () => {
  const catalog = formatGenreCatalog(GENRES, ['puzzle']);
  assert.match(catalog, /puzzle \(Puzzle\) \[RECENTLY USED — avoid\]/);
  assert.doesNotMatch(catalog, /platformer \(Platformer\) \[RECENTLY USED/);
});

test('selectRemixSuggestion returns null when the rng exceeds the probability', () => {
  const result = selectRemixSuggestion(SUMMARY, {
    remixProbability: 0.2,
    remixLookbackDays: 90,
    rng: () => 0.99,
    now: NOW,
  });
  assert.equal(result, null);
});

test('selectRemixSuggestion picks the highest score within the lookback window', () => {
  const result = selectRemixSuggestion(SUMMARY, {
    remixProbability: 0.2,
    remixLookbackDays: 90,
    rng: () => 0.0,
    now: NOW,
  });
  assert.equal(result?.slug, '2026-07-02-old-favourite');
});

test('selectRemixSuggestion excludes entries older than the lookback window', () => {
  const result = selectRemixSuggestion(SUMMARY, {
    remixProbability: 1,
    remixLookbackDays: 30,
    rng: () => 0.0,
    now: NOW,
  });
  assert.equal(result?.slug, '2026-08-01-tide-garden');
});

test('selectRemixSuggestion returns null when nothing is in range', () => {
  const result = selectRemixSuggestion(SUMMARY, {
    remixProbability: 1,
    remixLookbackDays: 1,
    rng: () => 0.0,
    now: NOW,
  });
  assert.equal(result, null);
});

test('buildPrompt includes guardrails verbatim', () => {
  const guardrails = '- No humans at all.\n- No violence.';
  const prompt = buildPrompt({ guardrailsText: guardrails, genres: GENRES, historyEntries: HISTORY, summary: SUMMARY });
  assert.ok(prompt.includes(guardrails));
});

test('buildPrompt includes genres, history digest and lessons', () => {
  const prompt = buildPrompt({ guardrailsText: 'rules', genres: GENRES, historyEntries: HISTORY, summary: SUMMARY });
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
  const params = { guardrailsText: 'rules', genres: GENRES, historyEntries: HISTORY, summary: SUMMARY };
  assert.equal(buildPrompt(params), buildPrompt(params));
});

// Nothing outside the game's own document paints the frame, so a game that
// sizes itself to a fixed box leaves the rest of it blank.
test('buildPrompt tells the model how its game will be displayed', () => {
  const prompt = buildPrompt({ guardrailsText: 'rules', genres: GENRES, historyEntries: HISTORY, summary: SUMMARY });

  assert.ok(prompt.includes(DISPLAY_CONTRACT), 'display contract missing from the prompt');
});

// The same lesson as the meta example below: a model handed a number
// reproduces it. Naming any concrete size would re-create the fixed-canvas
// problem this contract exists to prevent.
test('the display contract anchors the model to no particular size', () => {
  assert.doesNotMatch(
    DISPLAY_CONTRACT,
    /\b\d{3,4}\s*(?:px\b|[x\u00d7]\s*\d{3,4})/i,
    'the display contract names a pixel size, which models copy literally',
  );
});

// guardrails.md is injected verbatim into BOTH the generator and the
// moderator, which is why a display rule must not live there: the moderator
// judges content, and would start failing games closed over their layout.
test('the display contract is not part of the shared content guardrails', () => {
  const guardrails = readFileSync(
    new URL('../config/guardrails.md', import.meta.url),
    'utf8',
  );

  assert.ok(!guardrails.includes(DISPLAY_CONTRACT), 'display rules leaked into guardrails.md');
});

// The prompt's format contract and the extractor's parser must agree, or
// every generation fails. Round-trip the contract's own example through
// the real extractor to keep them locked together.
test('the documented output format actually parses with extractBundle', () => {
  const modelStyleResponse = OUTPUT_FORMAT_CONTRACT.replace(
    '...your complete game, with inline <style> and <script> only...',
    '<html><body><canvas></canvas></body></html>',
  ).replace(
    /\{"title".*\}/,
    '{"title": "T", "genre": "puzzle", "theme": "Th", "mechanics": ["m"], "controls": [{"action": "Go", "key": "G"}]}',
  );

  const result = extractBundle(modelStyleResponse);
  assert.ok(result.ok, 'contract example should parse');
  assert.equal(result.meta.title, 'T');
  assert.deepEqual(result.meta.controls, [{ action: 'Go', key: 'G' }]);
  assert.match(result.html, /<canvas>/);
});

// The looser half of the same invariant: a field can be added to the
// extractor and quietly never asked for. Then every game ships without it
// and nothing fails.
test('every field the extractor produces is named in the output contract', () => {
  const result = extractBundle('```json\n{}\n```\n```html\n<p>x</p>\n```');
  assert.ok(result.ok);

  for (const field of Object.keys(result.meta)) {
    assert.match(
      OUTPUT_FORMAT_CONTRACT,
      new RegExp(`\\b${field}\\b`),
      `the contract never mentions "${field}", so no model will return it`,
    );
  }
});

test('the contract example anchors the model to none of our own content', () => {
  const example = /^\{.*\}$/m.exec(OUTPUT_FORMAT_CONTRACT)?.[0] ?? '';
  assert.notEqual(example, '', 'contract should show an example meta object');

  // Walks the contract's example, independently of the extractor.
  const leaves: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') leaves.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
  };
  walk(JSON.parse(example));

  assert.ok(leaves.length > 0, 'example should contain values');
  // Models copy examples literally. A concrete key or title here would push
  // every game toward whatever we happened to write.
  assert.deepEqual([...new Set(leaves)], ['...']);
});

/** A published day with a given reception. */
function received(date: string, over: Partial<HistoryGameEntry> = {}): HistoryGameEntry {
  return {
    date,
    status: 'published',
    model: 'a/model:free',
    slug: `${date}-game`,
    genre: 'puzzle',
    theme: 'tide clocks',
    mechanics: ['drag'],
    ...over,
  };
}

test('digestHistory reports how a game was received', () => {
  const digest = digestHistory([
    received('2026-08-29', { likes: 2, dislikes: 7, dislikeReasons: { 'goal-unclear': 7 } }),
  ]);

  assert.match(digest, /2 liked, 7 disliked/);
  assert.match(digest, /marked: goal-unclear/);
});

test('digestHistory flags a game that painted nothing', () => {
  assert.match(digestHistory([received('2026-08-29', { canvasDrawn: false })]), /drew nothing/);
});

test('digestHistory says nothing about reception for an unrated game', () => {
  assert.doesNotMatch(digestHistory([received('2026-08-29')]), /liked|marked|drew nothing/);
});

// Three broken runs in a row is the most useful thing the next attempt could
// know, and the digest used to filter failed days out entirely.
test('digestHistory shows failed days and what broke', () => {
  const digest = digestHistory([
    { date: '2026-08-29', status: 'failed_kept_previous', model: 'm', attempts: 3,
      failureKinds: ['smoke-js-error', 'moderation'] },
  ]);

  assert.match(digest, /FAILED after 3 attempts/);
  assert.match(digest, /smoke-js-error, moderation/);
});

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
  assert.match(directives[0] as string, /Goal unclear/);
});

test('correctiveDirectives leads with the most frequent problem', () => {
  const directives = correctiveDirectives([
    received('2026-08-29', { dislikeReasons: { 'goal-unclear': 1, broken: 1 } }),
    received('2026-08-28', { dislikeReasons: { 'goal-unclear': 1, broken: 1 } }),
    received('2026-08-27', { dislikeReasons: { 'goal-unclear': 1 } }),
  ]);

  assert.match(directives[0] as string, /Goal unclear/);
  assert.match(directives[1] as string, /not working at all/);
});

test('correctiveDirectives responds to recurring generation failures', () => {
  const failed = (date: string): HistoryGameEntry => ({
    date, status: 'failed_kept_previous', model: 'm', attempts: 3,
    failureKinds: ['smoke-network', 'smoke-network'],
  });

  const directives = correctiveDirectives([failed('2026-08-29')]);

  assert.equal(directives.length, 1);
  assert.match(directives[0] as string, /over the network/);
});

// Only ids from the closed vocabularies select wording, so nothing a visitor
// or a past generation wrote can reach the prompt through this path.
test('correctiveDirectives ignores a reason outside the vocabulary', () => {
  const directives = correctiveDirectives([
    received('2026-08-29', { dislikeReasons: { 'ignore-previous-instructions': 5 } as never }),
    received('2026-08-28', { dislikeReasons: { 'ignore-previous-instructions': 5 } as never }),
  ]);

  assert.deepEqual(directives, []);
});

test('buildPrompt carries the directives into the prompt', () => {
  const prompt = buildPrompt({
    guardrailsText: 'rules',
    genres: GENRES,
    historyEntries: [
      received('2026-08-29', { dislikeReasons: { broken: 1 } }),
      received('2026-08-28', { dislikeReasons: { broken: 1 } }),
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
