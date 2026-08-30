import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ControlLegend } from './ControlLegend.tsx';

describe('ControlLegend', () => {
  it('shows what each input does and how to perform it', () => {
    render(
      <ControlLegend
        controls={[
          { action: 'Steer', key: 'Arrow keys' },
          { action: 'Boost', key: 'Shift' },
        ]}
      />,
    );

    expect(screen.getByText('Steer')).toBeVisible();
    expect(screen.getByText('Arrow keys')).toBeVisible();
    expect(screen.getByText('Boost')).toBeVisible();
    expect(screen.getByText('Shift')).toBeVisible();
  });

  it('keeps the order the game reported', () => {
    render(
      <ControlLegend
        controls={[
          { action: 'Up', key: 'W' },
          { action: 'Down', key: 'S' },
        ]}
      />,
    );

    const text = screen.getByRole('group', { name: /controls/i }).textContent ?? '';
    expect(text.indexOf('Up')).toBeLessThan(text.indexOf('Down'));
  });

  // A mouse-only game reports nothing, and an empty strip would just be a
  // stray border above the frame.
  it('renders nothing when the game reported no controls', () => {
    const { container } = render(<ControlLegend controls={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  // Control text is model-authored, so it is attacker-influenced in practice.
  it('escapes reported control text instead of rendering it as markup', () => {
    render(
      <ControlLegend
        controls={[{ action: '<img src=x onerror="globalThis.__xss=true">', key: 'K' }]}
      />,
    );

    expect(screen.getByText('<img src=x onerror="globalThis.__xss=true">')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });
});
