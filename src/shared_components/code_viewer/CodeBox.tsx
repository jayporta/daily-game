import { Icon } from '@/shared_components/Icon.tsx';
import { IconButton } from '@/shared_components/IconButton.tsx';
import { CopyCodeButton } from '@/shared_components/code_viewer/CopyCodeButton.tsx';

/**
 * Complete class strings per view, never assembled from fragments: Tailwind
 * only generates the classes it can read whole in the source.
 *
 * Both are dark in either theme. The two views show the same document and
 * should not change appearance between them, and an editor's ground is what
 * makes this read as source rather than as quoted prose — it is also what the
 * header controls need to be visible against, which they are not on the
 * panel's own background.
 */
const INLINE_FRAME =
  'flex flex-col overflow-hidden rounded-lg bg-slate-950 font-mono text-xs text-slate-100';
const FULL_FRAME = 'flex h-full flex-col bg-slate-950 font-mono text-xs text-slate-100';

/** Inline is capped and scrolls; full screen takes whatever is left under the header. */
const INLINE_SCROLL = 'flex max-h-48 overflow-auto';
const FULL_SCROLL = 'flex min-h-0 grow overflow-auto';

const EXPAND_ICON = (
  <Icon>
    <path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" />
  </Icon>
);

const CLOSE_ICON = (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

/**
 * The viewer's document: a header carrying the title, the copy button and the
 * full-screen toggle, over a line-numbered listing. `CodeViewer` wraps this
 * in a `role="dialog"` container while full screen.
 *
 * The gutter and the code are one text node each rather than an element per
 * line: a generated game runs to hundreds of lines, and a row per line would
 * put thousands of nodes on the page for something the visitor only glances
 * at. `whitespace-pre` rather than `pre-wrap`, so a long line scrolls sideways
 * as it would in an editor instead of reflowing and breaking the gutter's
 * alignment. The header sits outside that scroller, so it stays put while the
 * listing moves under it.
 */
interface CodeBoxProps {
  /** The document to display. Rendered as text — never as markup. */
  readonly code: string;
  /** Names the document in the header, and labels the full-screen dialog. */
  readonly title: string;
  /** One line number per line of `code`, newline-joined. */
  readonly lineNumbers: string;
  /** Whether the document is filling the screen. The viewer's only state. */
  readonly isFullscreen: boolean;
  /** Sets the full-screen state. */
  readonly setFullScreen: (bool: boolean) => void;
}

export function CodeBox({ isFullscreen, lineNumbers, code, title, setFullScreen }: CodeBoxProps) {
  return (
    <div className={isFullscreen ? FULL_FRAME : INLINE_FRAME}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <span className="truncate text-slate-400">{title}</span>
        <div className="flex shrink-0 items-center gap-2">
          <CopyCodeButton code={code} />
          <IconButton
            label={isFullscreen ? 'Close full screen code' : 'View code full screen'}
            onClick={() => setFullScreen(!isFullscreen)}
          >
            {isFullscreen ? CLOSE_ICON : EXPAND_ICON}
          </IconButton>
        </div>
      </div>
      <div className={isFullscreen ? FULL_SCROLL : INLINE_SCROLL}>
        <pre
          aria-hidden="true"
          className="shrink-0 border-r border-slate-700 px-2 py-2 text-right text-slate-500 select-none"
        >
          {lineNumbers}
        </pre>
        <pre className="grow px-3 py-2 whitespace-pre">{code}</pre>
      </div>
    </div>
  )
}
