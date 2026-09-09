import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GenerationConsole } from '@/features/byok/GenerationConsole.tsx';
import { ByokStatusContext } from '@/features/byok/state/context/byokStatusContext.ts';
import type { ByokStatus } from '@/features/byok/state/useByok.ts';

const RUN = { providerLabel: 'Anthropic', modelId: 'claude-opus-5' };

/**
 * The console against one exact status.
 *
 * Wrapped in the context rather than the real provider: every case here is
 * about what a given status renders, and the provider offers no way to be
 * put into one.
 */
function renderConsole(status: ByokStatus) {
  return render(
    <ByokStatusContext.Provider value={status}>
      <GenerationConsole />
    </ByokStatusContext.Provider>,
  );
}

const streaming = (output: string): ByokStatus => ({ status: 'streaming', run: RUN, output });

describe('GenerationConsole', () => {
  it('names the provider and model before any output arrives', () => {
    renderConsole(streaming(''));

    const log = screen.getByRole('region', { name: /generation output/i });
    expect(log).toHaveTextContent('connecting to Anthropic');
    expect(log).toHaveTextContent('claude-opus-5');
  });

  it('shows the output as it arrives', () => {
    renderConsole(streaming('```json\n{"title": "Prism Garden"}'));

    expect(screen.getByRole('region', { name: /generation output/i })).toHaveTextContent(
      'Prism Garden',
    );
  });

  // The console is a progress indicator, not a code reader: the full document
  // is browsable afterwards. Painting every line of a 30,000-character
  // generation would grow the DOM without bound while it streams, and make
  // each repaint more expensive than the last.
  it('paints only the tail of a long generation', () => {
    const lines = Array.from({ length: 400 }, (_, index) => `line ${index}`);

    renderConsole(streaming(lines.join('\n')));

    const log = screen.getByRole('region', { name: /generation output/i });
    expect(log).toHaveTextContent('line 399');
    expect(log).not.toHaveTextContent('line 0 ');
  });

  it('keeps a short generation whole rather than anchoring it to the bottom', () => {
    renderConsole(streaming('first\nsecond\nthird'));

    expect(screen.getByRole('region', { name: /generation output/i })).toHaveTextContent('first');
  });

  // The reason the console stays on screen after a failure: the partial
  // output plus the reason is the only record of what went wrong.
  it('reports a failure beneath what the model managed to say', () => {
    renderConsole({
      status: 'error',
      run: RUN,
      output: 'half a game',
      message: 'anthropic request failed (401): invalid key',
    });

    const log = screen.getByRole('region', { name: /generation output/i });
    expect(log).toHaveTextContent('half a game');
    expect(log).toHaveTextContent(/failed: anthropic request failed \(401\)/);
  });

  // The output is AI-authored markup. It renders as text through JSX, so
  // React escapes it; nothing on this page may ever interpret it as HTML.
  it('renders model markup as text, never as elements', () => {
    renderConsole(streaming('<img src="x" onerror="boom">'));

    const log = screen.getByRole('region', { name: /generation output/i });
    expect(log.querySelector('img')).toBeNull();
    expect(log).toHaveTextContent('<img src="x" onerror="boom">');
  });

  // A polite region repainted on every streamed fragment queues one
  // utterance per frame, which a screen reader reads long after the run has
  // finished. The output is silent; one status line speaks for it.
  it('leaves the streamed output unannounced', () => {
    renderConsole(streaming('line one\nline two'));

    expect(screen.getByRole('region', { name: /generation output/i })).toHaveAttribute(
      'aria-live',
      'off',
    );
    // The role itself must not announce either: `log` would, whatever
    // aria-live says on the screen readers that honour it unevenly.
    expect(screen.queryByRole('log')).toBeNull();
  });

  it('announces the run once, naming the provider', () => {
    renderConsole(streaming('half a game'));

    expect(screen.getByRole('status')).toHaveTextContent('Generating with Anthropic');
  });

  it('announces a failure in place of the run', () => {
    renderConsole({
      status: 'error',
      run: RUN,
      output: 'half a game',
      message: 'anthropic request failed (401): invalid key',
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Generation failed: anthropic request failed (401): invalid key',
    );
  });
});
