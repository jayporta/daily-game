// Catches a game whose script is a stand-in for code: an empty page, a lone
// `// Game code here`, or a few declarations cut off by `// ... more code`.

/**
 * The fewest non-whitespace characters, comments excluded, the inline scripts
 * of a game must hold between them. The smallest real game published so far
 * has about 2,100; the stand-ins seen have 0 to 431.
 */
export const MIN_SCRIPT_CHARS = 1000;

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const SRC_ATTRIBUTE = /(?:^|\s)src\s*=/i;
const TYPE_ATTRIBUTE = /(?:^|\s)type\s*=\s*["']?([^"'\s>]*)/i;
const SCRIPT_TYPE = /^(?:|module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
// One pass, so whichever comment opens first wins. A `//` counts only at a line
// start or after whitespace or `;{})`, so a URL's `://` keeps the rest of its line.
const COMMENT = /\/\*[\s\S]*?\*\/|(?<=^|[\s;{})])\/\/[^\n]*/gm;

/** Whether a `<script>` tag's attributes make it inline code the browser runs. */
function isInlineCode(attributes: string): boolean {
  if (SRC_ATTRIBUTE.test(attributes)) return false;
  const type = TYPE_ATTRIBUTE.exec(attributes)?.[1] ?? '';
  return SCRIPT_TYPE.test(type);
}

/**
 * Whether the page's own code is too short to be a game.
 *
 * @remarks
 * Only inline `<script>` bodies the browser runs count, since a game must be
 * self-contained: a `src` script, a data block such as
 * `type="application/json"`, or a script inside an HTML comment adds nothing.
 * Comments are stripped before counting. A `/*` or `//` inside a string
 * literal can still be read as a comment, which undercounts and so can only
 * reject a real game, never accept a stub.
 *
 * @param html - The model's complete HTML document.
 * @returns `true` when the inline scripts hold fewer than
 * {@link MIN_SCRIPT_CHARS} characters of code, or the page has none.
 */
export function isPlaceholderScript(html: string): boolean {
  let codeChars = 0;
  for (const [, attributes, body] of html.replace(HTML_COMMENT, '').matchAll(INLINE_SCRIPT)) {
    if (!isInlineCode(attributes ?? '')) continue;
    const code = (body ?? '').replace(COMMENT, '');
    codeChars += code.replace(/\s/g, '').length;
  }
  return codeChars < MIN_SCRIPT_CHARS;
}
