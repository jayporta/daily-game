import { useState } from 'react';
import { CodeOverlay } from '@/features/byok/CodeOverlay.tsx';
import { CodeViewer } from '@/features/byok/CodeViewer.tsx';
import { Disclosure } from '@/shared_components/Disclosure.tsx';
import { Icon } from '@/shared_components/Icon.tsx';
import { IconButton } from '@/shared_components/IconButton.tsx';

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
              <Icon>
                <path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" />
              </Icon>
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
