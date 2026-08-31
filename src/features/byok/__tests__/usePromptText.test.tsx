import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePromptText } from '../usePromptText.ts';

const PATH_A = 'games/archive/2026-08-29-a/prompt.txt';
const PATH_B = 'games/archive/2026-08-30-b/prompt.txt';

/** A fetch whose responses are released by the test, one path at a time. */
function controllableFetch() {
  const pending = new Map<string, (body: string) => void>();
  const fetchImpl: typeof fetch = (input) =>
    new Promise((resolve) => {
      pending.set(String(input), (body) => resolve(new Response(body, { status: 200 })));
    });
  return {
    fetchImpl,
    release: (path: string, body: string) => pending.get(path)?.(body),
  };
}

describe('usePromptText', () => {
  it('starts unrequested and fetches nothing', () => {
    const { fetchImpl } = controllableFetch();
    const { result } = renderHook(() => usePromptText(PATH_A, fetchImpl));

    expect(result.current.state).toEqual({ status: 'unrequested' });
  });

  it('joins the in-flight request rather than starting a second', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      return new Response(`prompt for ${String(input)}`, { status: 200 });
    };
    const { result } = renderHook(() => usePromptText(PATH_A, fetchImpl));

    await act(async () => {
      await Promise.all([result.current.load(), result.current.load()]);
    });

    expect(calls).toBe(1);
    expect(result.current.state).toEqual({ status: 'ready', text: `prompt for ${PATH_A}` });
  });

  it('reports a prompt that could not be loaded', async () => {
    const fetchImpl: typeof fetch = async () => new Response('', { status: 404 });
    const { result } = renderHook(() => usePromptText(PATH_A, fetchImpl));

    await act(async () => {
      expect(await result.current.load()).toBeNull();
    });

    expect(result.current.state).toEqual({ status: 'failed' });
  });

  // A superseded request cannot be cancelled — it is already in flight — so
  // the guard has to be that its answer is ignored, in either resolution
  // order. Without it, yesterday's prompt is displayed under today's game.
  it('ignores a response for a path that is no longer the current one', async () => {
    const { fetchImpl, release } = controllableFetch();
    const { result, rerender } = renderHook(({ path }) => usePromptText(path, fetchImpl), {
      initialProps: { path: PATH_A },
    });

    act(() => {
      void result.current.load();
    });
    rerender({ path: PATH_B });
    act(() => {
      void result.current.load();
    });

    // The new day's prompt lands first, then yesterday's straggles in.
    await act(async () => {
      release(PATH_B, "today's prompt");
      release(PATH_A, "yesterday's prompt");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'ready', text: "today's prompt" }),
    );
  });

  it('forgets what it knew about the previous path', async () => {
    const { fetchImpl, release } = controllableFetch();
    const { result, rerender } = renderHook(({ path }) => usePromptText(path, fetchImpl), {
      initialProps: { path: PATH_A },
    });

    act(() => {
      void result.current.load();
    });
    await act(async () => {
      release(PATH_A, "yesterday's prompt");
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: 'ready', text: "yesterday's prompt" });

    rerender({ path: PATH_B });

    expect(result.current.state).toEqual({ status: 'unrequested' });
  });
});
