import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGenerationStream } from '../useGenerationStream.ts';

/**
 * Takes manual control of the frame callbacks.
 *
 * @returns `paint`, which runs every callback queued since the last one, and
 *   `queued`, the number still outstanding.
 */
function controllableFrames() {
  let pending: (() => void)[] = [];
  let nextHandle = 1;
  const handles = new Map<number, () => void>();

  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    const handle = nextHandle++;
    handles.set(handle, callback);
    pending.push(callback);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    const callback = handles.get(handle);
    if (callback) pending = pending.filter((queued) => queued !== callback);
    handles.delete(handle);
  });

  return {
    paint: () => {
      const due = pending;
      pending = [];
      for (const callback of due) callback();
    },
    queued: () => pending.length,
  };
}

describe('useGenerationStream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows nothing before the first fragment arrives', () => {
    controllableFrames();
    const { result } = renderHook(() => useGenerationStream());

    expect(result.current.output).toBe('');
  });

  it('publishes what has arrived once the frame runs', () => {
    const frames = controllableFrames();
    const { result } = renderHook(() => useGenerationStream());

    act(() => {
      result.current.append('Hello');
    });
    expect(result.current.output).toBe('');

    act(() => {
      frames.paint();
    });
    expect(result.current.output).toBe('Hello');
  });

  // The whole reason this hook exists: a model emitting hundreds of tokens a
  // second must not queue hundreds of renders. Many fragments between two
  // paints have to collapse into one update.
  it('coalesces every fragment between paints into a single frame', () => {
    const frames = controllableFrames();
    const { result } = renderHook(() => useGenerationStream());

    act(() => {
      for (const fragment of ['a', 'b', 'c', 'd', 'e']) result.current.append(fragment);
    });

    expect(frames.queued()).toBe(1);

    act(() => {
      frames.paint();
    });
    expect(result.current.output).toBe('abcde');
  });

  it('keeps accumulating across paints', () => {
    const frames = controllableFrames();
    const { result } = renderHook(() => useGenerationStream());

    act(() => {
      result.current.append('one ');
      frames.paint();
    });
    act(() => {
      result.current.append('two');
      frames.paint();
    });

    expect(result.current.output).toBe('one two');
  });

  // A run that ends between paints would otherwise leave its last fragment
  // buffered and never shown — exactly the tail a failed run needs.
  it('flush publishes the tail without waiting for a frame', () => {
    controllableFrames();
    const { result } = renderHook(() => useGenerationStream());

    act(() => {
      result.current.append('the last words');
      result.current.flush();
    });

    expect(result.current.output).toBe('the last words');
  });

  it('reset clears the output for a fresh run', () => {
    const frames = controllableFrames();
    const { result } = renderHook(() => useGenerationStream());

    act(() => {
      result.current.append('old run');
      frames.paint();
    });
    act(() => {
      result.current.reset();
    });

    expect(result.current.output).toBe('');
  });

  // A fragment buffered before a reset must not reappear behind the next
  // run's output.
  it('reset drops a fragment that had not been painted yet', () => {
    const frames = controllableFrames();
    const { result } = renderHook(() => useGenerationStream());

    act(() => {
      result.current.append('abandoned');
      result.current.reset();
      result.current.append('fresh');
      frames.paint();
    });

    expect(result.current.output).toBe('fresh');
  });

  // A frame that runs inline — a synchronous polyfill, or a test that drives
  // paints itself — clears the handle before the request returns it. Storing
  // that dead handle would make every fragment after the first look like one
  // already scheduled, and the console would freeze after its first line.
  it('keeps scheduling after a frame that runs inline', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback();
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const { result } = renderHook(() => useGenerationStream());

    act(() => {
      result.current.append('first');
    });
    act(() => {
      result.current.append(' second');
    });

    expect(result.current.output).toBe('first second');
  });

  it('releases a pending frame when the component goes away', () => {
    const frames = controllableFrames();
    const { result, unmount } = renderHook(() => useGenerationStream());

    act(() => {
      result.current.append('mid-stream');
    });
    expect(frames.queued()).toBe(1);

    unmount();

    expect(frames.queued()).toBe(0);
  });
});
