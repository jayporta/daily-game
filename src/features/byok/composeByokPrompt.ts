// Assembling the prompt a visitor's own generation sends: the archived
// prompt, plus whatever this particular run adds to it.
//
// One function rather than assembly at the call site, because two places need
// the identical answer — the Generate button, and the disclosure promising
// "See the exact prompt this will send". A prompt composed twice is a
// disclosure that eventually lies.
import { renderAttemptFeedback } from '../../../lib/attempt-feedback.ts';

export interface ByokPromptParts {
  /** The archived prompt, already stripped of its own attempt feedback. */
  readonly basePrompt: string;
  /** Corrective wording from this visitor's own previous failed run. */
  readonly priorFailureFeedback?: string | undefined;
  /** The game currently on screen, when the visitor asked to include it. */
  readonly currentGameHtml?: string | undefined;
}

const CURRENT_GAME_HEADING = '## Improve on the game below';

/**
 * Closes the composed prompt when anything was appended.
 *
 * The archived prompt ends with the two-block output contract, so every
 * addition lands after it — including a fenced block of existing HTML, which
 * is the last thing the model should be left imitating.
 */
const FORMAT_REMINDER =
  'Everything above the previous section still applies: return EXACTLY two fenced code blocks, a `json` one and an `html` one, and nothing else.';

/**
 * The section handing the model the game to build on.
 *
 * Fenced as `html` because that is what it is, and labelled as input rather
 * than as an example of the answer — a model handed an unlabelled document
 * tends to return it back unchanged.
 */
function currentGameSection(html: string): string {
  return `
${CURRENT_GAME_HEADING}

This is the game currently on screen. Treat it as your starting point: keep
what works, and make it better — deeper play, clearer feedback, fewer rough
edges. Return a complete document of your own, not a diff.

It is a published bundle, so it carries two things the site added rather than
the game's author: a Content-Security-Policy meta tag, and an error-reporting
script at the end. Both are ours. Leave them out of your answer — the site
adds its own, and a copy would report this page's errors under the wrong name.

\`\`\`html
${html}
\`\`\`
`;
}

/**
 * The exact prompt a run will send.
 *
 * Returns `basePrompt` untouched when this run adds nothing, so the common
 * case shows the archived prompt byte for byte.
 *
 * @param priorFailureFeedback Rendered through the same
 *   {@link renderAttemptFeedback} the pipeline uses, so a visitor's retry and
 *   a pipeline retry read identically to the model.
 */
export function composeByokPrompt({
  basePrompt,
  priorFailureFeedback,
  currentGameHtml,
}: ByokPromptParts): string {
  const additions = [
    renderAttemptFeedback(priorFailureFeedback),
    currentGameHtml ? currentGameSection(currentGameHtml) : '',
  ].filter((section) => section.length > 0);

  if (additions.length === 0) return basePrompt;
  return `${basePrompt}\n${additions.join('')}\n${FORMAT_REMINDER}\n`;
}
