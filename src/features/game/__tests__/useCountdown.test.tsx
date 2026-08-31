import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCountdown } from '../useCountdown.ts';

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

  // Above an hour the label carries minutes, so the hook waits a minute at a
  // time. A 1 Hz clock produced the same labels and 59 wasted wakeups a minute.
  it('does not re-render on every second while the label it shows is unchanged', () => {
    const TICKS = 30;
    let renders = 0;
    // Six hours and 45 seconds out: every tick below reads "6h 0m".
    function Probe(): string {
      renders += 1;
      return useCountdown(expiryIn(6 * 3_600_000 + 45_000));
    }
    const { result } = renderHook(() => Probe());
    const rendersAfterMount = renders;
    expect(result.current).toBe('6h 0m');

    // One flush per tick, since a browser never batches across tasks.
    for (let second = 0; second < TICKS; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
    }

    expect(result.current).toBe('6h 0m');
    // React bails out on an unchanged label, so this stays a small constant.
    expect(renders - rendersAfterMount).toBeLessThan(TICKS / 2);
  });

  // Asserted on the timer count rather than on which clearing function ran:
  // what matters is that nothing is left pending, not how it was cancelled.
  it('leaves no pending timer after unmount', () => {
    const { unmount } = renderHook(() => useCountdown(expiryIn(60_000)));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  // Nothing about the label can change once it reads "any moment now", so the
  // hook stops rescheduling rather than waking every second until midnight.
  it('schedules nothing once the game is already due for replacement', () => {
    renderHook(() => useCountdown(expiryIn(-1_000)));

    expect(vi.getTimerCount()).toBe(0);
  });
});
