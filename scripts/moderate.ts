// Two-layer content moderation: a fast local keyword scan, then a second
// AI call (a different model than the generator) judging the bundle
// against config/guardrails.md verbatim.
//
// Both layers fail CLOSED: anything unparseable, empty or errored is
// treated as a rejection. A false rejection costs one retry; a false
// acceptance publishes banned content to a public site.
import type { ChatMessage, OpenRouterClient } from './lib/openrouter-client.ts';
import type { GeneratedMeta } from '../lib/types.ts';

/**
 * High-precision terms that are never acceptable. This is a fast
 * pre-filter, NOT the whole safety story — the AI check below reads the
 * full guardrails prose and catches everything nuanced. Terms are matched
 * on word boundaries, so `killTimer` and `manifest` do not trip `kill`
 * and `man`. Keep this list unambiguous: a term common in ordinary game
 * code (`player`, `shoot`, `hit`) belongs in the AI check, not here.
 */
export const BANNED_TERMS: readonly string[] = [
  // violence / gore
  'blood', 'bloody', 'gore', 'gory', 'corpse', 'murder', 'kill', 'stab',
  'decapitate', 'dismember', 'suicide',
  // sexual content
  'sex', 'sexual', 'nude', 'naked', 'porn', 'erotic',
  // drugs / alcohol / tobacco
  'cocaine', 'heroin', 'marijuana', 'cannabis', 'cigarette', 'vape',
  'alcohol', 'beer', 'wine', 'vodka', 'whiskey', 'drunk',
  // profanity
  'fuck', 'shit', 'bitch', 'bastard', 'damn',
  // human characters (guardrails forbid humans entirely)
  'human', 'man', 'woman', 'boy', 'girl', 'child', 'soldier', 'person',
  // real-world religion
  'jesus', 'christ', 'allah', 'muhammad', 'buddha', 'islam', 'christian',
  'jewish', 'hindu', 'bible', 'quran', 'torah',
];

export interface KeywordScanResult {
  pass: boolean;
  hits: string[];
}

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function keywordScan(text: string, bannedTerms: readonly string[] = BANNED_TERMS): KeywordScanResult {
  const hits = bannedTerms.filter((term) =>
    new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text),
  );
  return { pass: hits.length === 0, hits };
}

/** Everything a human would read: the metadata plus the game source. */
export function moderatableText(meta: GeneratedMeta, html: string): string {
  return [meta.title, meta.genre, meta.theme, ...meta.mechanics, html].join('\n');
}

export const MODERATION_SYSTEM_PROMPT =
  'You are a strict content moderator. You answer with exactly one word: PASS or FAIL. ' +
  'If any rule is broken, or you are unsure, answer FAIL.';

/**
 * Whether a request is a moderation call rather than a generation call.
 * Both go through the same client, so mocks and tests need to tell them
 * apart to answer each appropriately.
 */
export function isModerationRequest(messages: ChatMessage[]): boolean {
  return messages[0]?.content === MODERATION_SYSTEM_PROMPT;
}

export function buildModerationMessages(guardrailsText: string, meta: GeneratedMeta, html: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: MODERATION_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `Judge the following browser game against these rules.

## Rules

${guardrailsText}

## Game metadata

title: ${meta.title}
genre: ${meta.genre}
theme: ${meta.theme}
mechanics: ${meta.mechanics.join(', ')}

## Game source

${html}

## Your answer

Reply with exactly one word: PASS if the game breaks none of the rules,
FAIL if it breaks any rule or you are unsure.`,
    },
  ];
}

export interface AiModerationResult {
  pass: boolean;
  raw: string;
}

export async function aiModerationCheck(
  client: OpenRouterClient,
  { model, guardrailsText, meta, html }: { model: string; guardrailsText: string; meta: GeneratedMeta; html: string },
): Promise<AiModerationResult> {
  let raw: string;
  try {
    raw = await client.complete({
      model,
      messages: buildModerationMessages(guardrailsText, meta, html),
      temperature: 0,
    });
  } catch (error) {
    // An unreachable moderator is not permission to publish.
    return { pass: false, raw: `moderation call failed: ${(error as Error).message}` };
  }

  const normalized = raw.trim().toUpperCase();
  const saysFail = /\bFAIL\b/.test(normalized);
  const saysPass = /\bPASS\b/.test(normalized);

  // Fail closed: only an unambiguous PASS is a pass.
  return { pass: saysPass && !saysFail, raw };
}

export interface ModerationResult {
  pass: boolean;
  reasons: string[];
}

export interface ModerateParams {
  meta: GeneratedMeta;
  html: string;
  guardrailsText: string;
  moderationModel: string;
  bannedTerms?: readonly string[];
}

export async function moderate(
  client: OpenRouterClient,
  { meta, html, guardrailsText, moderationModel, bannedTerms = BANNED_TERMS }: ModerateParams,
): Promise<ModerationResult> {
  const scan = keywordScan(moderatableText(meta, html), bannedTerms);
  if (!scan.pass) {
    // Already definitively rejected — skip the AI call rather than pay for it.
    return { pass: false, reasons: [`banned terms present: ${scan.hits.join(', ')}`] };
  }

  const ai = await aiModerationCheck(client, { model: moderationModel, guardrailsText, meta, html });
  if (!ai.pass) {
    return { pass: false, reasons: [`moderation model rejected the game: ${ai.raw.trim().slice(0, 200)}`] };
  }

  return { pass: true, reasons: [] };
}
