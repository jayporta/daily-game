import { useEffect, useRef } from 'react';
import { CodeViewer } from '@/features/byok/CodeViewer.tsx';
import { Icon } from '@/shared_components/Icon.tsx';
import { IconButton } from '@/shared_components/IconButton.tsx';

export interface CodeOverlayProps {
  /** Named in the heading and as the dialog's accessible label. */
  readonly title: string;
  readonly code: string;
  readonly open: boolean;
  /** Called for the close button and for Escape alike. */
  readonly onClose: () => void;
}

/**
 * The generated source, full screen and read-only, over the page.
 *
 * A native `<dialog>` opened with `showModal`, so the browser supplies the
 * top layer, the backdrop, the focus trap and Escape — all of which a
 * hand-rolled overlay has to reimplement and usually gets wrong. It renders
 * over the page rather than replacing it: closing returns the visitor
 * exactly where they were, with the game still running behind.
 */
export function CodeOverlay({ title, code, open, onClose }: CodeOverlayProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  // Synchronising React state with a DOM element that owns its own open
  // state — the one thing an effect is for.
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;

    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label={`Source of ${title}`}
      // `close` fires for Escape and the backdrop too, so the parent's state
      // cannot be left believing the dialog is still open.
      onClose={onClose}
      className="m-0 h-full max-h-none w-full max-w-none bg-slate-950 text-slate-100 backdrop:bg-slate-950/70"
    >
      {/* Mounted only while open: the viewer holds the whole document, and
          nothing should lay that out for a dialog nobody has opened. */}
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <span className="font-mono text-xs text-slate-400">{title}</span>
            <IconButton label="Close full screen code" onClick={onClose}>
              <Icon>
                <path d="M6 6l12 12M18 6L6 18" />
              </Icon>
            </IconButton>
          </div>
          <div className="min-h-0 grow">
            <CodeViewer code={code} size="full" />
          </div>
        </div>
      )}
    </dialog>
  );
}
