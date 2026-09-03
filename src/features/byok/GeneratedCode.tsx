import { CodeViewer } from '@/shared_components/code_viewer/CodeViewer.tsx';
import { Disclosure } from '@/shared_components/Disclosure.tsx';

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
  return (
    <div className="text-ui">
      <Disclosure summary="View generated code">
        <CodeViewer code={html} title={title} />
      </Disclosure>
    </div>
  );
}
