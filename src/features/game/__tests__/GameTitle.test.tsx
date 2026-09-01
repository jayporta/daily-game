import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameTitle } from '@/features/game/GameTitle.tsx';
import { MANIFEST } from '@/lib/testFixtures.ts';

describe('GameTitle', () => {
  it('shows the title and genre', () => {
    render(<GameTitle title={MANIFEST.title} genreLabel={MANIFEST.genreLabel} />);

    expect(screen.getByRole('heading', { name: 'Beetle of a Thousand Mirrors' })).toBeVisible();
    expect(screen.getByText('Maze Adventure')).toBeVisible();
  });

  // A BYOK regeneration is not filed under the day's genre, so it shows none.
  it('omits the genre badge when there is no genre to show', () => {
    render(<GameTitle title="Regenerated Title" genreLabel={null} />);

    expect(screen.getByRole('heading', { name: 'Regenerated Title' })).toBeVisible();
    expect(screen.queryByText('Maze Adventure')).toBeNull();
  });

  // Titles come from a model, so they are attacker-influenced in practice.
  // JSX must escape them rather than parse them as markup.
  it('escapes AI-generated text instead of rendering it as markup', () => {
    render(
      <GameTitle
        title='<img src=x onerror="globalThis.__xss=true">'
        genreLabel={MANIFEST.genreLabel}
      />,
    );

    expect(
      screen.getByRole('heading', { name: '<img src=x onerror="globalThis.__xss=true">' }),
    ).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });
});
