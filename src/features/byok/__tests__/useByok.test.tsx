import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useByok, type ByokGenerateRequest } from '../useByok.ts';
import {
  BYOK_COMPLETION,
  BYOK_HTML,
  completionResponse,
  stubFetch,
} from '../../../lib/testFixtures.ts';

function baseParams(fetchImpl: typeof fetch) {
  return { systemPrompt: 'system', fetchImpl };
}

function request(over: Partial<ByokGenerateRequest> = {}): ByokGenerateRequest {
  return {
    provider: 'openrouter',
    modelId: 'a/model:free',
    providerLabel: 'OpenRouter',
    apiKey: 'key',
    userPrompt: 'user prompt',
    ...over,
  };
}

function succeeding() {
  return baseParams(stubFetch(completionResponse(BYOK_COMPLETION)));
}

describe('useByok', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useByok(succeeding()));
    expect(result.current.status).toEqual({ status: 'idle' });
  });

  it('transitions to loading synchronously when generate is called', () => {
    const { result } = renderHook(() => useByok(succeeding()));

    act(() => {
      void result.current.generate(request());
    });

    expect(result.current.status).toEqual({ status: 'loading' });
  });

  it('returns the generation on a successful adapter and extraction pass', async () => {
    const { result } = renderHook(() => useByok(succeeding()));

    let generated: Awaited<ReturnType<typeof result.current.generate>> = null;
    await act(async () => {
      generated = await result.current.generate(request());
    });

    expect(generated).toEqual({
      html: BYOK_HTML,
      meta: expect.objectContaining({ title: 'Regenerated Title' }),
      providerLabel: 'OpenRouter',
      modelId: 'a/model:free',
    });
  });

  // The success payload is handed back, not held: leaving the hook in a
  // `ready` state would be state the panel never renders.
  it('settles back to idle after a success rather than holding the result', async () => {
    const { result } = renderHook(() => useByok(succeeding()));

    await act(async () => {
      await result.current.generate(request());
    });

    expect(result.current.status).toEqual({ status: 'idle' });
  });

  it('transitions to error on a non-OK provider response, with a plain message', async () => {
    const { result } = renderHook(() =>
      useByok(baseParams(stubFetch(new Response('', { status: 401 })))),
    );

    let generated: Awaited<ReturnType<typeof result.current.generate>> = null;
    await act(async () => {
      generated = await result.current.generate(request());
    });

    expect(generated).toBeNull();
    expect(result.current.status.status).toBe('error');
    if (result.current.status.status === 'error') {
      expect(result.current.status.message).toMatch(/401/);
    }
  });

  it('transitions to error when the response does not parse as a game bundle', async () => {
    const { result } = renderHook(() =>
      useByok(baseParams(stubFetch(completionResponse('not a bundle')))),
    );

    await act(async () => {
      await result.current.generate(request());
    });

    expect(result.current.status.status).toBe('error');
  });

  it('never writes the key to localStorage or sessionStorage on success', async () => {
    const localSpy = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const sessionSpy = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', localSpy);
    vi.stubGlobal('sessionStorage', sessionSpy);

    const { result } = renderHook(() => useByok(succeeding()));
    await act(async () => {
      await result.current.generate(request({ apiKey: 'a-real-key' }));
    });

    expect(localSpy.setItem).not.toHaveBeenCalled();
    expect(sessionSpy.setItem).not.toHaveBeenCalled();
  });

  it('never writes the key to localStorage or sessionStorage on failure', async () => {
    const localSpy = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const sessionSpy = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', localSpy);
    vi.stubGlobal('sessionStorage', sessionSpy);

    const { result } = renderHook(() =>
      useByok(baseParams(stubFetch(new Response('', { status: 500 })))),
    );
    await act(async () => {
      await result.current.generate(request({ apiKey: 'a-real-key' }));
    });

    expect(localSpy.setItem).not.toHaveBeenCalled();
    expect(sessionSpy.setItem).not.toHaveBeenCalled();
  });
});
