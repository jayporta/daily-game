import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useByok } from '../useByok.ts';

const VALID_COMPLETION = [
  '```json',
  '{"title": "T", "genre": "maze-adventure", "theme": "th", "mechanics": ["m"], "controls": []}',
  '```',
  '',
  '```html',
  '<!doctype html><html><body>game</body></html>',
  '```',
].join('\n');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(response: Response): typeof fetch {
  return (async () => response) as typeof fetch;
}

function baseParams(fetchImpl: typeof fetch) {
  return { systemPrompt: 'system', userPrompt: 'user prompt', fetchImpl };
}

describe('useByok', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useByok(baseParams(stubFetch(jsonResponse({})))));
    expect(result.current.status).toEqual({ status: 'idle' });
  });

  it('transitions to loading synchronously when generate is called', () => {
    const { result } = renderHook(() =>
      useByok(baseParams(stubFetch(jsonResponse({ choices: [{ message: { content: VALID_COMPLETION } }] })))),
    );

    act(() => {
      void result.current.generate('openrouter', 'a/model:free', 'OpenRouter', 'key');
    });

    expect(result.current.status).toEqual({ status: 'loading' });
  });

  it('transitions to ready on a successful adapter and extraction pass', async () => {
    const { result } = renderHook(() =>
      useByok(baseParams(stubFetch(jsonResponse({ choices: [{ message: { content: VALID_COMPLETION } }] })))),
    );

    await act(async () => {
      await result.current.generate('openrouter', 'a/model:free', 'OpenRouter', 'key');
    });

    expect(result.current.status.status).toBe('ready');
    if (result.current.status.status === 'ready') {
      expect(result.current.status.html).toBe('<!doctype html><html><body>game</body></html>');
      expect(result.current.status.providerLabel).toBe('OpenRouter');
      expect(result.current.status.modelId).toBe('a/model:free');
    }
  });

  it('transitions to error on a non-OK provider response, with a plain message', async () => {
    const { result } = renderHook(() => useByok(baseParams(stubFetch(new Response('', { status: 401 })))));

    await act(async () => {
      await result.current.generate('openrouter', 'a/model:free', 'OpenRouter', 'bad-key');
    });

    expect(result.current.status.status).toBe('error');
    if (result.current.status.status === 'error') {
      expect(result.current.status.message).toMatch(/401/);
    }
  });

  it('transitions to error when the response does not parse as a game bundle', async () => {
    const { result } = renderHook(() =>
      useByok(baseParams(stubFetch(jsonResponse({ choices: [{ message: { content: 'not a bundle' } }] })))),
    );

    await act(async () => {
      await result.current.generate('openrouter', 'a/model:free', 'OpenRouter', 'key');
    });

    expect(result.current.status.status).toBe('error');
  });

  it('reset returns to idle from ready', async () => {
    const { result } = renderHook(() =>
      useByok(baseParams(stubFetch(jsonResponse({ choices: [{ message: { content: VALID_COMPLETION } }] })))),
    );

    await act(async () => {
      await result.current.generate('openrouter', 'a/model:free', 'OpenRouter', 'key');
    });
    expect(result.current.status.status).toBe('ready');

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toEqual({ status: 'idle' });
  });

  it('never calls localStorage.setItem or sessionStorage.setItem during a submit→success flow', async () => {
    const localSpy = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const sessionSpy = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const originalLocal = globalThis.localStorage;
    const originalSession = globalThis.sessionStorage;
    vi.stubGlobal('localStorage', localSpy);
    vi.stubGlobal('sessionStorage', sessionSpy);

    try {
      const { result } = renderHook(() =>
        useByok(baseParams(stubFetch(jsonResponse({ choices: [{ message: { content: VALID_COMPLETION } }] })))),
      );

      await act(async () => {
        await result.current.generate('openrouter', 'a/model:free', 'OpenRouter', 'a-real-looking-key');
      });

      expect(localSpy.setItem).not.toHaveBeenCalled();
      expect(sessionSpy.setItem).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('localStorage', originalLocal);
      vi.stubGlobal('sessionStorage', originalSession);
    }
  });

  it('never calls localStorage.setItem or sessionStorage.setItem during a submit→error flow', async () => {
    const localSpy = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const sessionSpy = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const originalLocal = globalThis.localStorage;
    const originalSession = globalThis.sessionStorage;
    vi.stubGlobal('localStorage', localSpy);
    vi.stubGlobal('sessionStorage', sessionSpy);

    try {
      const { result } = renderHook(() => useByok(baseParams(stubFetch(new Response('', { status: 500 })))));

      await act(async () => {
        await result.current.generate('openrouter', 'a/model:free', 'OpenRouter', 'a-real-looking-key');
      });

      expect(localSpy.setItem).not.toHaveBeenCalled();
      expect(sessionSpy.setItem).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('localStorage', originalLocal);
      vi.stubGlobal('sessionStorage', originalSession);
    }
  });
});
