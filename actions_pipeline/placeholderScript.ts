// Catches a game whose script is a stand-in for code: an empty page, a lone
// `// Game code here`, or a few declarations cut off by `// ... more code`.

/**
 * The fewest non-whitespace characters, comments excluded, the inline scripts
 * of a game must hold between them. The smallest real game published so far
 * has about 2,100; the stand-ins seen have 0 to 431.
 */
export const MIN_SCRIPT_CHARS = 1000;

// HTML comments and script elements in one left-to-right pass, so whichever
// opens first wins: a script inside a comment is skipped, and comment markers
// inside a script body stay part of it. Quoted attribute values may hold `>`.
const MARKUP = /<!--[\s\S]*?-->|<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
// One attribute per match, its value whole, so text inside a quoted value is
// never read as another attribute's name.
const ATTRIBUTE = /([^\s"'=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;
const SCRIPT_TYPE = /^(?:|module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;
const WHITESPACE = /\s/;

/** Whether a `<script>` tag's attributes make it inline code the browser runs. */
function isInlineCode(attributes: string): boolean {
  let type = '';
  for (const [, name = '', double, single, bare] of attributes.matchAll(ATTRIBUTE)) {
    const lower = name.toLowerCase();
    if (lower === 'src') return false;
    if (lower === 'type') type = (double ?? single ?? bare ?? '').trim();
  }
  return SCRIPT_TYPE.test(type);
}

/**
 * The index just past the string literal opening at `start`. A `'` or `"`
 * with no partner ends at its line, so a stray one in a regex literal cannot
 * swallow the rest of the script; a stray backtick runs to the next one.
 */
function stringEnd(source: string, start: number): number {
  const quote = source.charAt(start);
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source.charAt(i);
    if (char === '\\') i += 1;
    else if (char === quote || (char === '\n' && quote !== '`')) return i + 1;
  }
  return source.length;
}

/** Non-whitespace characters of `source` outside comments; string literals are code. */
function codeCharCount(source: string): number {
  let count = 0;
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    const next = source.charAt(i + 1);
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (char === '"' || char === "'" || char === '`') {
      const end = stringEnd(source, i);
      for (let j = i; j < end; j += 1) if (!WHITESPACE.test(source.charAt(j))) count += 1;
      i = end;
    } else {
      if (!WHITESPACE.test(char)) count += 1;
      i += 1;
    }
  }
  return count;
}

/**
 * Whether the page's own code is too short to be a game.
 *
 * @remarks
 * Only inline `<script>` bodies the browser runs count, since a game must be
 * self-contained: a `src` script, a data block such as
 * `type="application/json"`, or a script inside an HTML comment adds nothing.
 * JavaScript comments are skipped and string literals counted. Regex literals
 * are not recognised: a `//` or `/*` inside one reads as a comment, which
 * undercounts, and a quote inside one opens a string to the end of its line,
 * or to the next backtick, which overcounts by whatever follows on it.
 *
 * @param html - The model's complete HTML document.
 * @returns `true` when the inline scripts hold fewer than
 * {@link MIN_SCRIPT_CHARS} characters of code, or the page has none.
 */
export function isPlaceholderScript(html: string): boolean {
  let codeChars = 0;
  for (const [, attributes, body] of html.matchAll(MARKUP)) {
    // An HTML comment matches with neither group set.
    if (attributes === undefined || !isInlineCode(attributes)) continue;
    codeChars += codeCharCount(body ?? '');
  }
  return codeChars < MIN_SCRIPT_CHARS;
}
