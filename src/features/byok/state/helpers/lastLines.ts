/**
 * The last `limit` lines of `text`.
 *
 * Walks back from the end rather than splitting the whole string: this runs
 * on every streamed fragment, against everything received so far, so a split
 * would make each repaint more expensive than the last.
 *
 * @param limit How many lines to keep. At least 1.
 * @returns The whole string when it holds fewer lines than that, so a short
 *   run reads from its first line rather than being anchored to the bottom.
 */
export function lastLines(text: string, limit: number): string {
  let cut = text.length;
  for (let seen = 0; seen < limit; seen += 1) {
    // Nothing precedes index 0, and `lastIndexOf` clamps a negative start to
    // 0 rather than answering -1, so it would find the same newline forever.
    if (cut === 0) return text;
    const newline = text.lastIndexOf('\n', cut - 1);
    if (newline === -1) return text;
    cut = newline;
  }
  return text.slice(cut + 1);
}
