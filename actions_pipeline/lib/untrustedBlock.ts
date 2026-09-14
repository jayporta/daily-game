// Delimited blocks for text a prompt must present as data rather than as
// instructions: model-authored game source and metadata, and the history
// digest and lessons note that carry earlier model output forward.
//
// The tag prefix lives here rather than at the call sites so the wrapper and
// the escaper cannot drift apart. A block whose content can forge its own
// delimiter is not delimited at all.

/** Prefix on every delimiter tag, shared by {@link untrustedBlock} and {@link defangDelimiters}. */
const TAG_PREFIX = 'untrusted-';

// Matches only the `<` that opens a delimiter tag, so the rest of the
// sequence survives with its original casing. Whitespace is allowed
// everywhere a lenient reader would tolerate it: the model this protects
// reads prose, not well-formed markup, so `< / untrusted-x>` would still
// register as a closing tag.
const DELIMITER_OPENER = new RegExp(`<(?=\\s*/?\\s*${TAG_PREFIX})`, 'gi');

/**
 * Neutralizes any delimiter tag inside `content`.
 *
 * Escapes the `<` rather than dropping the text, so the model still reads the
 * characters the content actually contained. Opening tags are defanged as
 * well as closing ones: an injected opening tag lets content claim a block of
 * its own, which implies the enclosing one ended.
 *
 * @param content Untrusted text, of any shape.
 */
export function defangDelimiters(content: string): string {
  return content.replace(DELIMITER_OPENER, '&lt;');
}

/**
 * Wraps untrusted text in a named block for a prompt.
 *
 * @param name Block name. The `untrusted-` prefix is added here, so callers
 *   pass `game-source`, not `untrusted-game-source`.
 * @param content Model- or visitor-authored text. Defanged before wrapping.
 */
export function untrustedBlock(name: string, content: string): string {
  return `<${TAG_PREFIX}${name}>\n\n${defangDelimiters(content)}\n\n</${TAG_PREFIX}${name}>`;
}

/**
 * The closing tag for a block, for tests asserting a prompt holds exactly one.
 *
 * @param name The same name passed to {@link untrustedBlock}.
 */
export function closingTag(name: string): string {
  return `</${TAG_PREFIX}${name}>`;
}
