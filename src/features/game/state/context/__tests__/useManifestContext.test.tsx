import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useManifestContext } from '@/features/game/state/context/useManifestContext.ts';

function Reader() {
  useManifestContext();
  return null;
}

describe('useManifestContext', () => {
  // Reading it inside a provider is covered by every GameFacts test, which
  // renders through the real one.
  it('throws when no provider stands above it', () => {
    // React reports a render-phase throw through console.error, which would
    // otherwise read as a broken run rather than the expected failure.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Reader />)).toThrow(/ManifestProvider/);

    logged.mockRestore();
  });
});
