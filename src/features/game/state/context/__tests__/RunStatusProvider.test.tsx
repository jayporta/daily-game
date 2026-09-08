import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunStatusProvider } from '@/features/game/state/context/RunStatusProvider.tsx';
import { useRunStatusContext } from '@/features/game/state/context/useRunStatusContext.ts';
import { jsonResponse, RUN_STATUS } from '@/lib/testFixtures.ts';

/** What the provider was told to record. */
const { reported } = vi.hoisted(() => ({ reported: [] as unknown[] }));

vi.mock('@/lib/sentry.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sentry.ts')>()),
  reportError: (error: unknown) => {
    reported.push(error);
  },
}));

/** Every value the provider committed, so a value shown then withdrawn shows up. */
const seen: string[] = [];

function Reader() {
  const status = useRunStatusContext();
  const label = status === null ? 'nothing reported' : status.state;
  useEffect(() => {
    seen.push(label);
  }, [label]);
  return <span>{label}</span>;
}

function renderProvider(response: Response): void {
  vi.stubGlobal('fetch', async () => response);
  render(
    <RunStatusProvider>
      <Reader />
    </RunStatusProvider>,
  );
}

describe('RunStatusProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-29T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    reported.length = 0;
    seen.length = 0;
  });

  it('shares a published status with the tree below', async () => {
    renderProvider(jsonResponse(RUN_STATUS));

    expect(await screen.findByText('quota-exceeded')).toBeVisible();
  });

  it('reports nothing on the ordinary day with no status file', async () => {
    renderProvider(new Response('', { status: 404 }));

    expect(await screen.findByText('nothing reported')).toBeVisible();
    expect(reported).toHaveLength(0);
  });

  // The page must never be left promising a retry that has already come and
  // gone, so the provider drops it rather than making readers hold a clock.
  it('never hands down a status whose retry has already fallen due', async () => {
    vi.setSystemTime(new Date('2026-08-31T00:00:00.000Z'));
    renderProvider(jsonResponse(RUN_STATUS));

    expect(await screen.findByText('nothing reported')).toBeVisible();
    // Not merely absent at the end: it must never have been shown, or the
    // page would flash a message it immediately withdraws.
    expect(seen).not.toContain('quota-exceeded');
  });

  it('drops the status when its retry falls due while the page is open', async () => {
    vi.setSystemTime(new Date('2026-08-30T18:59:58.000Z'));
    renderProvider(jsonResponse(RUN_STATUS));
    expect(await screen.findByText('quota-exceeded')).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(screen.getByText('nothing reported')).toBeVisible();
  });

  // A status the page cannot read is worth knowing about, but must never stop
  // it showing the game.
  it('records an unreadable status and carries on without one', async () => {
    renderProvider(jsonResponse({ date: '2026-08-30' }));

    expect(await screen.findByText('nothing reported')).toBeVisible();
    await waitFor(() => expect(reported).toHaveLength(1));
  });
});
