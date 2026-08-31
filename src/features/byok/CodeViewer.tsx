import { useMemo } from 'react';

/** Where the viewer is being shown, which is all that changes about it. */
export type CodeViewerSize = 'inline' | 'full';

export interface CodeViewerProps {
  /** The document to display. Rendered as text — never as markup. */
  readonly code: string;
  /** `inline` sits inside a disclosure; `full` fills the overlay. */
  readonly size: CodeViewerSize;
}

/**
 * Complete class strings per size, never assembled from fragments: Tailwind
 * only generates the classes it can read whole in the source.
 *
 * Both are dark in either theme. The two views show the same document and
 * should not change appearance between them, and an editor's ground is what
 * makes this read as source rather than as quoted prose — it is also what
 * the expand control needs to be visible against, which it is not on the
 * panel's own background.
 */
const CONTAINER: Record<CodeViewerSize, string> = {
  inline: 'flex max-h-48 overflow-auto rounded-lg bg-slate-950 font-mono text-xs text-slate-100',
  full: 'flex h-full overflow-auto bg-slate-950 font-mono text-xs text-slate-100',
};

/**
 * Read-only source, left-aligned with a line-number gutter.
 *
 * The gutter and the code are one text node each rather than an element per
 * line: a generated game runs to hundreds of lines, and a row per line would
 * put thousands of nodes on the page for something the visitor only glances
 * at. Two `<pre>` blocks in one scroll container stay aligned because both
 * use the same monospace line height.
 *
 * `whitespace-pre` rather than `pre-wrap`, so a long line scrolls sideways
 * as it would in an editor instead of reflowing and breaking the gutter's
 * alignment.
 */
export function CodeViewer({ code, size }: CodeViewerProps) {
  // Recomputed only when the code itself changes: the overlay opening and
  // closing must not re-count the lines of a document that has not moved.
  const lineNumbers = useMemo(() => {
    const total = code.split('\n').length;
    return Array.from({ length: total }, (_, index) => index + 1).join('\n');
  }, [code]);

  return (
    <div className={CONTAINER[size]}>
      <pre
        aria-hidden="true"
        className="shrink-0 border-r border-slate-700 px-2 py-2 text-right text-slate-500 select-none"
      >
        {lineNumbers}
      </pre>
      <pre className="grow px-3 py-2 whitespace-pre">{code}</pre>
    </div>
  );
}
