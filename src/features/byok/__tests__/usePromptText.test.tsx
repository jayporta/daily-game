import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePromptText } from '@/features/byok/usePromptText.ts';
import {
  ATTEMPT_FEEDBACK_HEADING,
  renderAttemptFeedback,
} from '#lib/attempt-feedback.ts';

/** What the hook asked to have recorded. */
const { reported } = vi.hoisted(() => ({ reported: [] as unknown[] }));

vi.mock('@/lib/sentry.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sentry.ts')>()),
  reportError: (error: unknown) => {
    reported.push(error);
  },
}));

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

  // The archived prompt records the attempt that succeeded, corrections to
  // the attempt before it included. A visitor's run is a first attempt, so
  // being told to fix a failure that never happened describes nothing.
  it('drops the correction addressed to a previous failed attempt', async () => {
    const archived = `## Genre catalog\n\n- puzzle\n${renderAttemptFeedback(
      'Your previous game made a network request.',
    )}\n## Output format\n\nTwo fenced blocks.\n`;
    const fetchImpl: typeof fetch = async () => new Response(archived, { status: 200 });
    const { result } = renderHook(() => usePromptText(PATH_A, fetchImpl));

    let sent: string | null = null;
    await act(async () => {
      sent = await result.current.load();
    });

    expect(sent).not.toContain(ATTEMPT_FEEDBACK_HEADING);
    expect(sent).not.toContain('made a network request');
    expect(sent).toContain('## Output format');
  });

  // The panel promises "the exact prompt this will send", so what the
  // disclosure renders and what Generate posts have to be one string.
  it('shows the disclosure the same text it sends', async () => {
    const archived = `## Genre catalog\n${renderAttemptFeedback('Be defensive.')}\n## Output format\n`;
    const fetchImpl: typeof fetch = async () => new Response(archived, { status: 200 });
    const { result } = renderHook(() => usePromptText(PATH_A, fetchImpl));

    let sent: string | null = null;
    await act(async () => {
      sent = await result.current.load();
    });

    expect(result.current.state).toEqual({ status: 'ready', text: sent });
  });

  it('reports a prompt that could not be loaded', async () => {
    const fetchImpl: typeof fetch = async () => new Response('', { status: 404 });
    const { result } = renderHook(() => usePromptText(PATH_A, fetchImpl));

    await act(async () => {
      expect(await result.current.load()).toBeNull();
    });

    expect(result.current.state).toEqual({ status: 'failed' });
  });

  // A missing prompt disables the whole BYOK panel while the rest of the page
  // looks healthy, so nothing else on the page would ever surface it.
  it('records a prompt that could not be loaded', async () => {
    reported.length = 0;
    const fetchImpl: typeof fetch = async () => new Response('', { status: 404 });
    const { result } = renderHook(() => usePromptText(PATH_A, fetchImpl));

    await act(async () => {
      await result.current.load();
    });

    expect(reported).toHaveLength(1);
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
