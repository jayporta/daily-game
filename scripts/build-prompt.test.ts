import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTPUT_FORMAT_CONTRACT,
  buildPrompt,
  digestHistory,
  formatGenreCatalog,
  recentlyUsedGenreIds,
  selectRemixSuggestion,
} from './build-prompt.ts';
import { extractBundle } from '../lib/extract-bundle-shared.ts';
import type { GenresConfig, HistoryGameEntry, HistorySummary } from './lib/types.ts';

const GENRES: GenresConfig = [
  { id: 'maze-adventure', label: 'Maze Adventure', examples: ['navigate a maze'] },
  { id: 'platformer', label: 'Platformer', examples: ['jump between platforms'] },
  { id: 'puzzle', label: 'Puzzle', examples: ['rearrange tiles'] },
];

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

test('digestHistory lists only published entries, newest first', () => {
  const digest = digestHistory(HISTORY);
  const lines = digest.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0] as string, /2026-08-28/);
  assert.match(lines[1] as string, /2026-08-27/);
  assert.doesNotMatch(digest, /2026-08-26/);
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
