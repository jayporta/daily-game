// The reflection prompt, split out from reflect-lessons.ts so the mock
// client can recognise a lessons call without importing the module that
// builds a real client — which would close an import cycle.
import type { ChatMessage } from './openrouter-client.ts';
import type { HistoryGameEntry, HistorySummary } from './types.ts';

/**
 * Character cap on the lessons prose, for the same reason. The model is
 * asked for a few paragraphs; this is the backstop if it ignores that.
 */
export const MAX_LESSONS_LENGTH = 4_000;

export const LESSONS_SYSTEM_PROMPT =
  'You distil build notes for a daily AI-generated game project. You reply with prose only — ' +
  'no preamble, no headings, no code fences, no lists.';

/** The prompt asking for a rewritten lessons section. */
export function buildLessonsMessages(
  summary: HistorySummary,
  aging: readonly HistoryGameEntry[],
): ChatMessage[] {
  const digest = aging
    .map((entry) => {
      const parts = [
        `date: ${entry.date}`,
        `status: ${entry.status}`,
        `genre: ${entry.genre ?? 'unknown'}`,
        `theme: ${entry.theme ?? 'unknown'}`,
        `mechanics: ${entry.mechanics?.join(', ') || 'unrecorded'}`,
        `attempts: ${entry.attempts ?? 'unrecorded'}`,
      ];
      if (entry.likes !== undefined) parts.push(`likes: ${entry.likes}`);
      if (entry.dislikes !== undefined) parts.push(`dislikes: ${entry.dislikes}`);
      const reasons = Object.entries(entry.dislikeReasons ?? {})
        .filter(([, count]) => count > 0)
        .map(([id, count]) => `${id}: ${count}`);
      if (reasons.length > 0) parts.push(`disliked for: ${reasons.join(', ')}`);
      if (entry.errors?.length) parts.push(`runtime errors: ${entry.errors.length}`);
      for (const reason of entry.failureReasons ?? []) parts.push(`failed: ${reason}`);
      return `- ${parts.join(' · ')}`;
    })
    .join('\n');

  return [
    { role: 'system', content: LESSONS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `These games are ageing out of the project's recent history. Rewrite the
"lessons" note that is shown to the model building each new game.

## The current lessons note

${summary.lessons.trim() || '(nothing recorded yet)'}

## Games ageing out

${digest}

## What to write

A few short paragraphs, at most 300 words, covering recurring pitfalls, what
reliably worked, and genre or mechanic combinations worth revisiting. Fold the
current note in rather than discarding it, and drop anything it says that these
games no longer support. Write only the note itself.`,
    },
  ];
}

/**
 * Whether a request is a lessons rewrite rather than a generation call.
 *
 * Generation, moderation and reflection share one client, so a mock has to
 * tell them apart — otherwise a fixture game answers a reflection call and
 * lands in `summary.json` as the note shown to every later prompt.
 */
export function isLessonsRequest(messages: ChatMessage[]): boolean {
  return messages[0]?.content === LESSONS_SYSTEM_PROMPT;
}
