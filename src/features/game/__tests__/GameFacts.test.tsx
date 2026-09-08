import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '#lib/manifest.ts';
import type { RunStatus } from '#lib/status.ts';
import { GameFacts } from '@/features/game/GameFacts.tsx';
import { ManifestProvider } from '@/features/game/state/context/ManifestProvider.tsx';
import { RunStatusContext } from '@/features/game/state/context/runStatusContext.ts';
import { MANIFEST, RUN_STATUS } from '@/lib/testFixtures.ts';

const NOW = new Date('2026-08-29T12:00:00.000Z');

/** Renders through the real providers, so the wiring is under test too. */
function renderFacts(manifest: Manifest = MANIFEST, runStatus: RunStatus | null = null): void {
  render(
    <ManifestProvider manifest={manifest}>
      <RunStatusContext.Provider value={runStatus}>
        <GameFacts />
      </RunStatusContext.Provider>
    </ManifestProvider>,
  );
}

describe('GameFacts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the model that built the game', () => {
    renderFacts();

    expect(screen.getByText('qwen/qwen-2.5-72b-instruct:free')).toBeVisible();
  });

  it('renders the generated date in UTC, independent of viewer timezone', () => {
    renderFacts();

    expect(screen.getByText(/Generated 8\/29\/26/)).toBeVisible();
  });

  it('shows how long the current game has left', () => {
    renderFacts();

    expect(screen.getByText('6h 0m')).toBeVisible();
  });

  it('says the replacement is imminent once the expiry has passed', () => {
    renderFacts({ ...MANIFEST, expiresAt: '2026-08-29T11:00:00.000Z' });

    expect(screen.getByText('a few moments')).toBeVisible();
  });

  it('degrades to a placeholder when the generated date is unusable', () => {
    renderFacts({ ...MANIFEST, generatedAt: 'not-a-date' });

    expect(screen.getByText(/Generated unknown date/)).toBeVisible();
  });

  // The model id is not ours either, so it escapes like everything else.
  it('escapes the model id instead of rendering it as markup', () => {
    renderFacts({ ...MANIFEST, model: '<img src=x onerror="alert(1)">' });

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  // Counting down to a game the provider cannot produce promises something
  // the site already knows it will not deliver.
  it('says the quota ran out instead of counting down to a game that is not coming', () => {
    renderFacts(MANIFEST, RUN_STATUS);

    // A message that arrives on its own waits its turn rather than cutting in.
    expect(screen.getByRole('status')).toHaveTextContent(
      'OpenRouter quota exceeded. Will try again tomorrow.',
    );
    expect(screen.queryByText('6h 0m')).toBeNull();
  });

  // Expiry by retry time is the provider's job, not this component's: it only
  // ever hands down a status whose retry is still ahead. See
  // RunStatusProvider.test.tsx and isRetryTimePast.
  it('goes back to counting down once a newer game has arrived', () => {
    renderFacts({ ...MANIFEST, date: '2026-08-30' }, RUN_STATUS);

    expect(screen.getByText('6h 0m')).toBeVisible();
  });
});
