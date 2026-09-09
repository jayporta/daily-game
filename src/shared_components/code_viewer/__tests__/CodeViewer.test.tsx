import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CodeViewer } from '@/shared_components/code_viewer/CodeViewer.tsx';

const CODE = '<!doctype html>\n<body>a game</body>';

const expandButton = (): HTMLElement =>
  screen.getByRole('button', { name: /view code full screen/i });

describe('CodeViewer', () => {
  it('shows the listing in place, with nothing opened over it', () => {
    render(<CodeViewer code={CODE} title="Beetle Maze" />);

    expect(screen.getByText(/a game/)).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // The substance of using a real <dialog>: focus moving in and staying
  // there, Escape, and an inert background are the element's own behaviour,
  // and none of it applies to a div wearing role="dialog". jsdom implements
  // none of it either, so this asserts the element rather than the effects.
  it('opens the full-screen view as a real dialog element', async () => {
    render(<CodeViewer code={CODE} title="Beetle Maze" />);

    await userEvent.click(expandButton());

    const dialog = screen.getByRole('dialog', { name: /source of beetle maze/i });
    expect(dialog.tagName).toBe('DIALOG');
    expect((dialog as HTMLDialogElement).open).toBe(true);
  });

  it('closes again from its own control', async () => {
    render(<CodeViewer code={CODE} title="Beetle Maze" />);
    await userEvent.click(expandButton());

    await userEvent.click(screen.getByRole('button', { name: /close full screen code/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(expandButton()).toBeVisible();
  });

  // Escape is the browser's to handle, and it closes the dialog without
  // telling React. Without the onClose handler the page would be left
  // believing it is still full screen, showing neither view.
  it('returns to the listing when the browser closes the dialog', async () => {
    render(<CodeViewer code={CODE} title="Beetle Maze" />);
    await userEvent.click(expandButton());
    const dialog = screen.getByRole('dialog');

    // Outside React's own event path, exactly as the browser's Escape is.
    await act(async () => {
      (dialog as HTMLDialogElement).close();
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(expandButton()).toBeVisible();
  });
});
