import { useEffect, useMemo, useRef, useState } from 'react';
import { CodeBox } from '@/shared_components/code_viewer/CodeBox.tsx';

/**
 * Full-screen styling for the dialog itself.
 *
 * A `<dialog>` arrives centred and sized to its content, so every one of
 * these overrides a user-agent style rather than decorating.
 */
const FULL_SCREEN =
  'fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none bg-slate-950 p-0 opacity-100';

export interface CodeViewerProps {
  /** The document to display. Rendered as text — never as markup. */
  readonly code: string;
  /** Names the document in the header, and labels the full-screen dialog. */
  readonly title: string;
}

/**
 * Read-only source with a line-number gutter, a copy button and a full-screen
 * toggle — collapsed in place by default, full screen on request. Fully
 * self-contained: drop it anywhere with just `code` and `title`.
 */
export function CodeViewer({ code, title }: CodeViewerProps) {
  const [fullScreen, setFullScreen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const lineNumbers = useMemo(() => {
    const total = code.split('\n').length;
    return Array.from({ length: total }, (_, index) => index + 1).join('\n');
  }, [code]);

  // Synchronising with the element's own modal state, which React does not
  // model. `showModal` is what moves focus in, keeps it there, closes on
  // Escape and makes the rest of the page inert — none of which a div with
  // role="dialog" does on its own.
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (fullScreen && !element.open) element.showModal();
    if (!fullScreen && element.open) element.close();
  }, [fullScreen]);

  const codebox = (
    <CodeBox
      isFullscreen={fullScreen}
      setFullScreen={setFullScreen}
      lineNumbers={lineNumbers}
      code={code}
      title={title}
    />
  );

  return (
    <>
      {!fullScreen && codebox}

      {/* Always mounted, because `showModal` has to be called on an element
          that is already there. Empty while closed, and a closed dialog is
          display:none, so it costs the page nothing. */}
      <dialog
        ref={dialog}
        aria-label={`Source of ${title}`}
        onClose={() => setFullScreen(false)}
        className={FULL_SCREEN}
      >
        {fullScreen && codebox}
      </dialog>
    </>
  );
}
