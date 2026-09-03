import { CodeBox } from '@/shared_components/code_viewer/CodeBox.tsx';
import { useMemo, useState } from 'react';

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

  const lineNumbers = useMemo(() => {
    const total = code.split('\n').length;
    return Array.from({ length: total }, (_, index) => index + 1).join('\n');
  }, [code]);

  const codebox = (
    <CodeBox
      isFullscreen={fullScreen}
      setFullScreen={setFullScreen}
      lineNumbers={lineNumbers}
      code={code}
      title={title}
    />
  );

  if (!fullScreen) return codebox;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Source of ${title}`}
      className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none bg-slate-950 p-0 opacity-100"
    >
      {codebox}
    </div>
  );
}
