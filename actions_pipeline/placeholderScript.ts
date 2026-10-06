// Catches a game whose script is a stand-in for code: an empty page, a lone
// `// Game code here`, or a few declarations cut off by `// ... more code`.

/**
 * The fewest non-whitespace characters, comments excluded, the inline scripts
 * of a game must hold between them. The smallest real game published so far
 * has about 2,100; the stand-ins seen have 0 to 431.
 */
export const MIN_SCRIPT_CHARS = 1000;

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const SRC_ATTRIBUTE = /\bsrc\s*=/i;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/[^\n]*/g;

/**
 * Whether the page's own code is too short to be a game.
 *
 * @remarks
 * Only inline `<script>` bodies count, since a game must be self-contained.
 * Comments are stripped before counting. The `//` strip also eats the tail of
 * a URL string, which only undercounts, so it can wrongly reject a game that
 * sits just above the floor but never wrongly accept a stub.
 *
 * @param html - The model's complete HTML document.
 * @returns `true` when the inline scripts hold fewer than
 * {@link MIN_SCRIPT_CHARS} characters of code, or the page has none.
 */
export function isPlaceholderScript(html: string): boolean {
  let codeChars = 0;
  for (const [, attributes, body] of html.matchAll(INLINE_SCRIPT)) {
    if (SRC_ATTRIBUTE.test(attributes ?? '')) continue;
    const code = (body ?? '').replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
    codeChars += code.replace(/\s/g, '').length;
  }
  return codeChars < MIN_SCRIPT_CHARS;
}
