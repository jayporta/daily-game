import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameMeta } from './GameMeta.tsx';
import { MANIFEST } from '../lib/fixtures.ts';

const NOW = new Date('2026-08-29T12:00:00.000Z');

describe('GameMeta', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the title, genre and generating model', () => {
    render(<GameMeta manifest={MANIFEST} />);

    expect(screen.getByRole('heading', { name: 'Beetle of a Thousand Mirrors' })).toBeVisible();
    expect(screen.getByText('Maze Adventure')).toBeVisible();
    expect(screen.getByText('qwen/qwen-2.5-72b-instruct:free')).toBeVisible();
  });

  it('renders the generated date in UTC, independent of viewer timezone', () => {
    render(<GameMeta manifest={MANIFEST} />);

    expect(screen.getByText(/Generated Aug 29, 2026/)).toBeVisible();
  });

  it('shows how long the current game has left', () => {
    render(<GameMeta manifest={MANIFEST} />);

    expect(screen.getByText('6h 0m')).toBeVisible();
  });

  it('says the replacement is imminent once the expiry has passed', () => {
    render(<GameMeta manifest={{ ...MANIFEST, expiresAt: '2026-08-29T11:00:00.000Z' }} />);

    expect(screen.getByText('any moment now')).toBeVisible();
  });

  // Titles and themes come from a model, so they are attacker-influenced in
  // practice. JSX must escape them rather than parse them as markup.
  it('escapes AI-generated text instead of rendering it as markup', () => {
    render(
      <GameMeta
        manifest={{ ...MANIFEST, title: '<img src=x onerror="globalThis.__xss=true">' }}
      />,
    );

    expect(
      screen.getByRole('heading', { name: '<img src=x onerror="globalThis.__xss=true">' }),
    ).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  it('degrades to a placeholder when the generated date is unusable', () => {
    render(<GameMeta manifest={{ ...MANIFEST, generatedAt: 'not-a-date' }} />);

    expect(screen.getByText(/Generated unknown date/)).toBeVisible();
  });
});
