import { useState } from 'react';
import { CodeOverlay } from './CodeOverlay.tsx';
import { CodeViewer } from './CodeViewer.tsx';
import { Disclosure } from './Disclosure.tsx';
import { IconButton } from '../../ui/IconButton.tsx';

export interface GeneratedCodeProps {
  /** The document in the frame — the day's game, or a visitor's own. */
  readonly html: string;
  /** The game's title, used to label the full-screen view. */
  readonly title: string;
}

/**
 * Lets a visitor read the code behind the game on screen — collapsed under it
 * by default, full screen on request.
 *
 * Shown for whichever game is in the frame, the day's published one included,
 * and handed the same `html` the frame is: the viewer exists to answer "what
 * am I playing", which it can only do while the two cannot disagree.
 */
export function GeneratedCode({ html, title }: GeneratedCodeProps) {
  const [fullScreen, setFullScreen] = useState(false);

  return (
    <>
    <div className="text-ui">
      <Disclosure
        summary="View generated code"
        action={
          <IconButton label="View code full screen" onClick={() => setFullScreen(true)}>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4.5"
            >
              <path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" />
            </svg>
          </IconButton>
        }
      >
        <CodeViewer code={html} size="inline" />
      </Disclosure>
      </div>
      <CodeOverlay
        title={title}
        code={html}
        open={fullScreen}
        onClose={() => setFullScreen(false)}
      />
    </>
  );
}
