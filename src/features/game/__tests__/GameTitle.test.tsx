import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameTitle } from '../GameTitle.tsx';
import { MANIFEST } from '../../../lib/testFixtures.ts';

describe('GameTitle', () => {
  it('shows the title and genre', () => {
    render(<GameTitle manifest={MANIFEST} />);

    expect(screen.getByRole('heading', { name: 'Beetle of a Thousand Mirrors' })).toBeVisible();
    expect(screen.getByText('Maze Adventure')).toBeVisible();
  });

  // Titles come from a model, so they are attacker-influenced in practice.
  // JSX must escape them rather than parse them as markup.
  it('escapes AI-generated text instead of rendering it as markup', () => {
    render(
      <GameTitle manifest={{ ...MANIFEST, title: '<img src=x onerror="globalThis.__xss=true">' }} />,
    );

    expect(
      screen.getByRole('heading', { name: '<img src=x onerror="globalThis.__xss=true">' }),
    ).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });
});
