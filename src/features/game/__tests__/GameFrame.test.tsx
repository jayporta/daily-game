import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameFrame } from '@/features/game/GameFrame.tsx';
import { BUNDLE } from '@/lib/testFixtures.ts';

describe('GameFrame', () => {
  it('renders the bundle inline via srcdoc rather than a navigable src', () => {
    render(<GameFrame html={BUNDLE} title="Beetle Maze" />);
    const frame = screen.getByTitle('Beetle Maze');

    expect(frame).toHaveAttribute('srcdoc', BUNDLE);
    expect(frame).not.toHaveAttribute('src');
  });

  // The sandbox is the site's entire trust boundary. This assertion exists
  // to make weakening it fail loudly rather than silently: exact equality,
  // so `allow-same-origin`, `allow-top-navigation` and `allow-popups` all
  // fail here.
  it('sandboxes the frame with allow-scripts and nothing else', () => {
    render(<GameFrame html={BUNDLE} title="Beetle Maze" />);

    expect(screen.getByTitle('Beetle Maze')).toHaveAttribute('sandbox', 'allow-scripts');
  });

  it('does not execute the bundle in the parent document', () => {
    // If the html were ever injected instead of framed, this script would run.
    render(
      <GameFrame
        html="<script>globalThis.__escaped = true;</script>"
        title="Escape attempt"
      />,
    );

    expect(Reflect.get(globalThis, '__escaped')).toBeUndefined();
  });
});
