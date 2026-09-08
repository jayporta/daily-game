import { useEffect, useRef, useState } from 'react';

export interface GenerationStream {
  /** Everything received so far, as of the last flush. */
  readonly output: string;
  /** Records a fragment. Cheap enough to call for every token. */
  append: (fragment: string) => void;
  /** Applies whatever is buffered immediately, without waiting for a frame. */
  flush: () => void;
  /** Drops the buffer and the rendered output, for a fresh run. */
  reset: () => void;
}

/**
 * Accumulates a model's output for display, at the screen's pace.
 *
 * A fast model emits fragments far quicker than a browser can paint, and
 * setting state on each one would queue a render per token. Fragments land in
 * a ref instead and are published once per animation frame, so the console
 * repaints at most as often as the display refreshes however fast the tokens
 * arrive — and stops entirely when the tab is hidden.
 *
 * Separate from `useByok` so the batching can be tested on its own, and so
 * neither hook has two jobs.
 */
export function useGenerationStream(): GenerationStream {
  const [output, setOutput] = useState('');
  const buffered = useRef('');
  const scheduled = useRef(false);
  const handle = useRef<number | null>(null);

  const publish = (): void => {
    scheduled.current = false;
    handle.current = null;
    setOutput(buffered.current);
  };

  const cancel = (): void => {
    if (handle.current !== null) cancelAnimationFrame(handle.current);
    handle.current = null;
    scheduled.current = false;
  };

  // The only effect here: a pending frame is a browser-held callback, and it
  // has to be released when the component goes away.
  useEffect(() => cancel, []);

  const append = (fragment: string): void => {
    buffered.current += fragment;
    if (scheduled.current) return;

    // `scheduled` is raised before the request and is what guards against a
    // second one. The handle cannot: a frame that runs inline clears it
    // before this assignment, which would then store a dead handle and block
    // every later fragment for the rest of the run.
    scheduled.current = true;
    const requested = requestAnimationFrame(publish);
    if (scheduled.current) handle.current = requested;
  };

  const flush = (): void => {
    cancel();
    setOutput(buffered.current);
  };

  const reset = (): void => {
    cancel();
    buffered.current = '';
    setOutput('');
  };

  return { output, append, flush, reset };
}
