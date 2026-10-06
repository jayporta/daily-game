// The output-format contract the model is asked to follow, and the check for
// a model that echoed the contract's own placeholder values back.

import type { GeneratedMeta } from '#lib/extractBundleShared.ts';

/**
 * The two-fenced-block contract, including the requirement that the html block
 * hold the whole game. This is the parsing contract enforced by
 * lib/extractBundleShared.ts — if you change the fence languages here,
 * change the extractor's regexes to match, or every generation will fail.
 * The html example carries no ellipsis or code comment, which a model would
 * copy as its game.
 */
export const OUTPUT_FORMAT_CONTRACT = `Return EXACTLY two fenced code blocks and nothing else that could be mistaken for them.

First, a block tagged \`json\` containing only this object:
\`\`\`json
{"title": "...", "genre": "...", "theme": "...", "mechanics": ["...", "..."], "controls": [{"action": "...", "key": "..."}]}
\`\`\`

Second, a block tagged \`html\` containing the entire game as ONE self-contained HTML file:
\`\`\`html
<!doctype html>
(the whole game: inline style and script, every line written out in full)
\`\`\`

The \`genre\` value must be one of the genre ids listed above. The html block
must be a complete, immediately playable document that needs no other files.

Write every line of the game: setup, the game loop, drawing, every input
handler, scoring and how it ends. Never stand in for code with a comment, an
ellipsis, "TODO" or a note like "game logic here" or "rest of the code" — an
abbreviated script publishes as a page that does nothing. If the game you have
in mind is too big to write out in full, make a smaller one: a short game that
works beats an ambitious one left unfinished.

The \`controls\` array must list the inputs your game actually listens for,
using whatever control scheme you chose — \`action\` describes what it does in
your game, \`key\` is what the player presses, clicks or drags. List only
inputs the code really handles, and return an empty array if the game needs
none.`;

/** The literal placeholder text used by every field in {@link OUTPUT_FORMAT_CONTRACT}'s example. */
const PLACEHOLDER_TEXT = '...';

/**
 * Whether the model left the output contract's own example values in place
 * instead of describing the game it wrote.
 *
 * @remarks
 * `genre` is checked separately, against the catalogue — this covers the
 * fields with no fixed vocabulary, so a response that fills in a real genre
 * but leaves every other field as `"..."` still fails. A model can pair a
 * real genre with a game that otherwise paints something (a static score
 * overlay, say), which passes the smoke test's render check while every
 * other field is still the unfilled example — this is the metadata-side
 * check that catches that case.
 *
 * @param meta - The extracted metadata to check.
 */
export function isPlaceholderMeta(meta: GeneratedMeta): boolean {
  return (
    meta.title.trim() === PLACEHOLDER_TEXT ||
    meta.theme.trim() === PLACEHOLDER_TEXT ||
    meta.mechanics.some((mechanic) => mechanic.trim() === PLACEHOLDER_TEXT) ||
    meta.controls.some(
      (control) =>
        control.action.trim() === PLACEHOLDER_TEXT || control.key.trim() === PLACEHOLDER_TEXT,
    )
  );
}
