import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCountdown } from './useCountdown.ts';

const NOW = new Date('2026-08-29T12:00:00.000Z');

/** An expiry a fixed distance from the frozen clock. */
function expiryIn(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the remaining time on first render', () => {
    const { result } = renderHook(() => useCountdown(expiryIn(6 * 3_600_000 + 12 * 60_000)));
    expect(result.current).toBe('6h 12m');
  });

  it('counts down as time passes', () => {
    const { result } = renderHook(() => useCountdown(expiryIn(90_000)));
    expect(result.current).toBe('1m 30s');

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current).toBe('1m 0s');
  });

  it('lands on the expired label once the game is due for replacement', () => {
    const { result } = renderHook(() => useCountdown(expiryIn(2_000)));

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(result.current).toBe('any moment now');
  });

  it('recomputes when a new expiry is passed in', () => {
    const { result, rerender } = renderHook(({ expiresAt }) => useCountdown(expiresAt), {
      initialProps: { expiresAt: expiryIn(60_000) },
    });
    expect(result.current).toBe('1m 0s');

    rerender({ expiresAt: expiryIn(3 * 3_600_000) });

    expect(result.current).toBe('3h 0m');
  });

  it('stops its interval on unmount so nothing ticks after teardown', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useCountdown(expiryIn(60_000)));
    const pendingBefore = vi.getTimerCount();

    unmount();

    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeLessThan(pendingBefore);
  });
});
