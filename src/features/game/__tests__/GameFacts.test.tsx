import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameFacts } from '@/features/game/GameFacts.tsx';
import { MANIFEST } from '@/lib/testFixtures.ts';

const NOW = new Date('2026-08-29T12:00:00.000Z');

describe('GameFacts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the model that built the game', () => {
    render(<GameFacts manifest={MANIFEST} />);

    expect(screen.getByText('qwen/qwen-2.5-72b-instruct:free')).toBeVisible();
  });

  it('renders the generated date in UTC, independent of viewer timezone', () => {
    render(<GameFacts manifest={MANIFEST} />);

    expect(screen.getByText(/Generated 8\/29\/26/)).toBeVisible();
  });

  it('shows how long the current game has left', () => {
    render(<GameFacts manifest={MANIFEST} />);

    expect(screen.getByText('6h 0m')).toBeVisible();
  });

  it('says the replacement is imminent once the expiry has passed', () => {
    render(<GameFacts manifest={{ ...MANIFEST, expiresAt: '2026-08-29T11:00:00.000Z' }} />);

    expect(screen.getByText('any moment now')).toBeVisible();
  });

  it('degrades to a placeholder when the generated date is unusable', () => {
    render(<GameFacts manifest={{ ...MANIFEST, generatedAt: 'not-a-date' }} />);

    expect(screen.getByText(/Generated unknown date/)).toBeVisible();
  });

  // The model id is not ours either, so it escapes like everything else.
  it('escapes the model id instead of rendering it as markup', () => {
    render(<GameFacts manifest={{ ...MANIFEST, model: '<img src=x onerror="alert(1)">' }} />);

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });
});
