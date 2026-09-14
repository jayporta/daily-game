// The one prompt section that is addressed to a specific failed attempt,
// with the two operations that have to agree about it: the pipeline writes
// it, and the browser takes it back out.
//
// Isomorphic for the same reason as system-prompt.ts — BYOK re-sends an
// archived prompt from the browser, and scripts/ is Node-only. Keeping the
// heading, the rendering and the removal in one module is what stops the
// writer and the stripper drifting into a section that can never be found.

/** The heading that opens the section, and the anchor the stripper matches. */
export const ATTEMPT_FEEDBACK_HEADING = '## Fix this — your previous attempt failed';

/**
 * The section telling a retry what its predecessor got wrong.
 *
 * @param priorFailureFeedback Corrective wording for the previous attempt.
 * @returns The rendered section, or `''` when no attempt has failed yet —
 *   the first attempt of a run has nothing to correct.
 */
export function renderAttemptFeedback(priorFailureFeedback?: string): string {
  if (!priorFailureFeedback) return '';
  return `
${ATTEMPT_FEEDBACK_HEADING}

${priorFailureFeedback}

Be more defensive this time. Re-read the rules above before you start.
`;
}

/**
 * The section, and everything up to the next heading, removed.
 *
 * An archived `prompt.txt` is the exact prompt that produced that day's
 * game, retry corrections and all. Replayed under someone else's key it is a
 * fresh first attempt, so an instruction to fix what a different model did
 * hours earlier describes nothing that exists.
 *
 * Bounded by the next `## ` heading rather than by a length, since the
 * feedback text varies with the failure. Only this section goes: the
 * history-derived `## Fix what has been going wrong` is guidance any
 * generation can still act on.
 *
 * @param prompt A prompt as `build-prompt.ts` assembled it.
 * @returns The prompt unchanged when it carries no such section.
 */
export function stripAttemptFeedback(prompt: string): string {
  return prompt.replace(ATTEMPT_FEEDBACK_SECTION_RE, '');
}

/**
 * Matches from the heading to just before the next heading, or to the end.
 *
 * The lazy body plus the lookahead is what stops it swallowing the rest of
 * the prompt when the section is not the last one.
 */
const ATTEMPT_FEEDBACK_SECTION_RE = new RegExp(
  `\\n?${ATTEMPT_FEEDBACK_HEADING.replace('—', '\\u2014')}\\n[\\s\\S]*?(?=\\n## |$)`,
);
