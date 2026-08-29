import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameFrame } from './GameFrame.tsx';

const BUNDLE = '<!doctype html><html><body><canvas></canvas></body></html>';

describe('GameFrame', () => {
  it('renders the bundle inline via srcdoc rather than a navigable src', () => {
    render(<GameFrame html={BUNDLE} title="Beetle Maze" />);
    const frame = screen.getByTitle('Beetle Maze');

    expect(frame).toHaveAttribute('srcdoc', BUNDLE);
    expect(frame).not.toHaveAttribute('src');
  });

  // The sandbox is the site's entire trust boundary. These assertions exist
  // to make weakening it fail loudly rather than silently.
  it('sandboxes the frame with allow-scripts only', () => {
    render(<GameFrame html={BUNDLE} title="Beetle Maze" />);

    expect(screen.getByTitle('Beetle Maze')).toHaveAttribute('sandbox', 'allow-scripts');
  });

  it.each(['allow-same-origin', 'allow-top-navigation', 'allow-popups'])(
    'never grants %s',
    (token) => {
      render(<GameFrame html={BUNDLE} title="Beetle Maze" />);
      const sandbox = screen.getByTitle('Beetle Maze').getAttribute('sandbox') ?? '';

      expect(sandbox.split(/\s+/)).not.toContain(token);
    },
  );

  it('does not execute the bundle in the parent document', () => {
    // If the html were ever injected instead of framed, this script would run.
    render(
      <GameFrame
        html="<script>globalThis.__escaped = true;</script>"
        title="Escape attempt"
      />,
    );

    expect((globalThis as Record<string, unknown>).__escaped).toBeUndefined();
  });
});
