// The most important tests in the project: a bug here silently defeats
// the whole safety design, so every layer is checked for failing CLOSED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiModerationCheck,
  buildModerationMessages,
  keywordScan,
  moderate,
  moderatableText,
} from './moderate.ts';
import { loadFixtureBundle } from './lib/fixtures.ts';
import { loadGuardrails } from './lib/config-store.ts';
import type { OpenRouterClient } from './lib/openrouter-client.ts';
import type { GeneratedMeta } from '../lib/types.ts';

const GUARDRAILS = loadGuardrails();

/** A moderator that always answers the same thing. */
function stubModerator(reply: string): OpenRouterClient {
  return { async complete() { return reply; } };
}

function throwingModerator(message: string): OpenRouterClient {
  return { async complete() { throw new Error(message); } };
}

const CLEAN_META: GeneratedMeta = {
  controls: [],
  title: 'Beetle Maze',
  genre: 'maze-adventure',
  theme: 'glass beetles',
  mechanics: ['move', 'collect'],
};

test('keywordScan flags an obvious guardrail violation', () => {
  const result = keywordScan('the screen fills with blood');
  assert.equal(result.pass, false);
  assert.deepEqual(result.hits, ['blood']);
});

test('keywordScan passes clean game text', () => {
  const result = keywordScan('a glass beetle collects shards in a mirrored maze');
  assert.equal(result.pass, true);
  assert.deepEqual(result.hits, []);
});

test('keywordScan matches on word boundaries, not substrings', () => {
  // These must NOT trip `kill`, `man` or `sex` — they are ordinary code/prose.
  assert.equal(keywordScan('killTimer = setInterval(fn, 100)').pass, true);
  assert.equal(keywordScan('const manifest = {}').pass, true);
  assert.equal(keywordScan('the sextant points north').pass, true);
});

test('keywordScan still catches the standalone forms of those words', () => {
  assert.equal(keywordScan('you kill the beast').pass, false);
  assert.equal(keywordScan('a man walks by').pass, false);
});

test('keywordScan is case-insensitive', () => {
  assert.equal(keywordScan('BLOOD everywhere').pass, false);
});

test('moderatableText includes metadata, not just the html', () => {
  const text = moderatableText({ ...CLEAN_META, theme: 'a blood moon' }, '<div></div>');
  assert.match(text, /blood moon/);
  assert.equal(keywordScan(text).pass, false);
});

test('aiModerationCheck accepts an unambiguous PASS', async () => {
  const result = await aiModerationCheck(stubModerator('PASS'), {
    model: 'mod',
    guardrailsText: GUARDRAILS,
    meta: CLEAN_META,
    html: '<div></div>',
  });
  assert.equal(result.pass, true);
});

test('aiModerationCheck rejects a FAIL verdict', async () => {
  const result = await aiModerationCheck(stubModerator('FAIL: depicts a human character'), {
    model: 'mod',
    guardrailsText: GUARDRAILS,
    meta: CLEAN_META,
    html: '<div></div>',
  });
  assert.equal(result.pass, false);
});

test('aiModerationCheck fails closed on an ambiguous answer', async () => {
  for (const reply of ['', 'maybe?', 'I think it is fine', 'PASS but also FAIL']) {
    const result = await aiModerationCheck(stubModerator(reply), {
      model: 'mod',
      guardrailsText: GUARDRAILS,
      meta: CLEAN_META,
      html: '<div></div>',
    });
    assert.equal(result.pass, false, `reply ${JSON.stringify(reply)} must not pass`);
  }
});

test('aiModerationCheck fails closed when the moderation call throws', async () => {
  const result = await aiModerationCheck(throwingModerator('rate limited'), {
    model: 'mod',
    guardrailsText: GUARDRAILS,
    meta: CLEAN_META,
    html: '<div></div>',
  });
  assert.equal(result.pass, false);
  assert.match(result.raw, /rate limited/);
});

test('moderate rejects the known-bad guardrail fixture', async () => {
  const { meta, html } = loadFixtureBundle('bad-guardrail-word');
  // Even with a moderator that would wave it through, the keyword scan must catch it.
  const result = await moderate(stubModerator('PASS'), {
    meta,
    html,
    guardrailsText: GUARDRAILS,
    moderationModel: 'mod',
  });
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(' '), /banned terms present/);
});

test('moderate accepts the known-good fixtures', async () => {
  for (const name of ['good-maze', 'good-platformer'] as const) {
    const { meta, html } = loadFixtureBundle(name);
    const result = await moderate(stubModerator('PASS'), {
      meta,
      html,
      guardrailsText: GUARDRAILS,
      moderationModel: 'mod',
    });
    assert.equal(result.pass, true, `${name} should pass: ${result.reasons.join('; ')}`);
  }
});

test('moderate rejects content only the AI check can catch', async () => {
  // No banned keyword appears, so the keyword scan passes and the verdict
  // rests entirely on the moderation model.
  const sneaky: GeneratedMeta = {
    controls: [],
    title: 'Playground Friends',
    genre: 'puzzle',
    theme: 'two schoolkids trading lunch snacks',
    mechanics: ['drag', 'swap'],
  };
  assert.equal(keywordScan(moderatableText(sneaky, '<div></div>')).pass, true);

  const result = await moderate(stubModerator('FAIL: depicts human characters'), {
    meta: sneaky,
    html: '<div></div>',
    guardrailsText: GUARDRAILS,
    moderationModel: 'mod',
  });
  assert.equal(result.pass, false);
  assert.match(result.reasons.join(' '), /moderation model rejected/);
});

test('moderate skips the AI call once the keyword scan has already failed', async () => {
  let aiCalls = 0;
  const countingModerator: OpenRouterClient = {
    async complete() {
      aiCalls += 1;
      return 'PASS';
    },
  };
  const { meta, html } = loadFixtureBundle('bad-guardrail-word');
  await moderate(countingModerator, { meta, html, guardrailsText: GUARDRAILS, moderationModel: 'mod' });
  assert.equal(aiCalls, 0);
});

/**
 * Every string anywhere inside a value, however deeply nested.
 *
 * Kept independent of moderate.ts's own walker: the tests below use this to
 * enumerate what should have reached the moderator.
 */
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringLeaves);
  return [];
}

/** Distinct sentinels, so a field being dropped is unmistakable. */
const SENTINEL_META: GeneratedMeta = {
  title: 'zzTITLEzz',
  genre: 'zzGENREzz',
  theme: 'zzTHEMEzz',
  mechanics: ['zzMECHANICzz'],
  controls: [{ action: 'zzACTIONzz', key: 'zzKEYzz' }],
};

// Both moderation paths used to hand-enumerate the metadata fields, so a
// new field reached the published page unmoderated and nothing failed.
// These two lock that shut for whatever gets added next.
test('every string in the metadata reaches the keyword scan', () => {
  const text = moderatableText(SENTINEL_META, '<html>zzHTMLzz</html>');

  for (const leaf of [...stringLeaves(SENTINEL_META), 'zzHTMLzz']) {
    assert.ok(text.includes(leaf), `${leaf} never reached the keyword scan`);
  }
});

test('every string in the metadata reaches the moderating model', () => {
  const messages = buildModerationMessages('rules', SENTINEL_META, '<html>zzHTMLzz</html>');
  const prompt = messages.map((message) => message.content).join('\n');

  for (const leaf of [...stringLeaves(SENTINEL_META), 'zzHTMLzz']) {
    assert.ok(prompt.includes(leaf), `${leaf} was never shown to the moderator`);
  }
});

test('a banned term hidden in the reported controls is still caught', async () => {
  const meta: GeneratedMeta = {
    ...CLEAN_META,
    controls: [{ action: 'Spray blood', key: 'B' }],
  };

  const result = await moderate(stubModerator('PASS'), {
    meta,
    html: '<html></html>',
    guardrailsText: GUARDRAILS,
    moderationModel: 'mod/model',
  });

  assert.equal(result.pass, false);
});
