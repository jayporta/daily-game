import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GenerationConsole } from '@/features/byok/GenerationConsole.tsx';

const RUNNING = {
  providerLabel: 'Anthropic',
  modelId: 'claude-opus-5',
  failure: null,
};

describe('GenerationConsole', () => {
  it('names the provider and model before any output arrives', () => {
    render(<GenerationConsole {...RUNNING} output="" />);

    const log = screen.getByRole('log', { name: /generation output/i });
    expect(log).toHaveTextContent('connecting to Anthropic');
    expect(log).toHaveTextContent('claude-opus-5');
  });

  it('shows the output as it arrives', () => {
    render(<GenerationConsole {...RUNNING} output={'```json\n{"title": "Prism Garden"}'} />);

    expect(screen.getByRole('log')).toHaveTextContent('Prism Garden');
  });

  // The console is a progress indicator, not a code reader: the full document
  // is browsable afterwards. Painting every line of a 30,000-character
  // generation would grow the DOM without bound while it streams, and make
  // each repaint more expensive than the last.
  it('paints only the tail of a long generation', () => {
    const lines = Array.from({ length: 400 }, (_, index) => `line ${index}`);

    render(<GenerationConsole {...RUNNING} output={lines.join('\n')} />);

    const log = screen.getByRole('log');
    expect(log).toHaveTextContent('line 399');
    expect(log).not.toHaveTextContent('line 0 ');
  });

  it('keeps a short generation whole rather than anchoring it to the bottom', () => {
    render(<GenerationConsole {...RUNNING} output={'first\nsecond\nthird'} />);

    expect(screen.getByRole('log')).toHaveTextContent('first');
  });

  // The reason the console stays on screen after a failure: the partial
  // output plus the reason is the only record of what went wrong.
  it('reports a failure beneath what the model managed to say', () => {
    render(
      <GenerationConsole
        {...RUNNING}
        output="half a game"
        failure="anthropic request failed (401): invalid key"
      />,
    );

    const log = screen.getByRole('log');
    expect(log).toHaveTextContent('half a game');
    expect(log).toHaveTextContent(/failed: anthropic request failed \(401\)/);
  });

  // The output is AI-authored markup. It renders as text through JSX, so
  // React escapes it; nothing on this page may ever interpret it as HTML.
  it('renders model markup as text, never as elements', () => {
    render(<GenerationConsole {...RUNNING} output='<img src="x" onerror="boom">' />);

    const log = screen.getByRole('log');
    expect(log.querySelector('img')).toBeNull();
    expect(log).toHaveTextContent('<img src="x" onerror="boom">');
  });
});
