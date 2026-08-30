import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App.tsx';
import { BUNDLE, MANIFEST } from './lib/fixtures.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Stubs global fetch, routing manifest and bundle requests separately so a
 * test can fail one without the other.
 */
function stubFetch(handlers: { manifest: () => Response; game?: () => Response }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('manifest.json')) return handlers.manifest();
      return handlers.game?.() ?? new Response(BUNDLE, { status: 200 });
    }),
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-29T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the game and its metadata once both requests succeed', async () => {
    stubFetch({ manifest: () => jsonResponse(MANIFEST) });
    render(<App />);

    const frame = await screen.findByTitle('Beetle of a Thousand Mirrors');
    expect(frame).toHaveAttribute('srcdoc', BUNDLE);
    expect(screen.getByText('Maze Adventure')).toBeVisible();
  });

  it('invites a local generation run when nothing has been published yet', async () => {
    // The seed manifest is literally `null` until the pipeline first runs.
    stubFetch({ manifest: () => jsonResponse(null) });
    render(<App />);

    expect(await screen.findByText(/No game has been published yet/)).toBeVisible();
    expect(screen.queryByTitle(/Beetle/)).toBeNull();
  });

  it('reports a failure to load the manifest', async () => {
    stubFetch({ manifest: () => jsonResponse({}, 500) });
    render(<App />);

    expect(await screen.findByText(/could not load manifest \(500\)/)).toBeVisible();
  });

  // The two requests fail independently; a good manifest with a missing
  // bundle must not leave the viewer stuck on "Loading".
  it('reports a failure to load the bundle even when the manifest was fine', async () => {
    stubFetch({
      manifest: () => jsonResponse(MANIFEST),
      game: () => new Response('', { status: 404 }),
    });
    render(<App />);

    expect(await screen.findByText(/could not load game \(404\)/)).toBeVisible();
    expect(screen.queryByTitle(/Beetle/)).toBeNull();
  });

  it('treats a malformed manifest as nothing-published rather than crashing', async () => {
    stubFetch({ manifest: () => jsonResponse({ slug: 'only-a-slug' }) });
    render(<App />);

    expect(await screen.findByText(/No game has been published yet/)).toBeVisible();
  });

  it('shows a loading state before the requests settle', () => {
    stubFetch({ manifest: () => jsonResponse(MANIFEST) });
    render(<App />);

    expect(screen.getByText(/Loading today/)).toBeVisible();
  });

  it('does not update state after unmount', async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));

    let releaseManifest: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      releaseManifest = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await pending;
        return jsonResponse(MANIFEST);
      }),
    );

    const { unmount } = render(<App />);
    unmount();
    releaseManifest?.();

    await waitFor(() => {
      expect(errors).toEqual([]);
    });
  });
  it('lets the viewer rate the game once it has loaded', async () => {
    stubFetch({ manifest: () => jsonResponse(MANIFEST) });
    render(<App />);

    await waitFor(() => expect(screen.getByRole('group', { name: /rate this game/i })).toBeVisible());
    expect(screen.getByRole('button', { name: /^like$/i })).toBeVisible();
  });

  // The frame holds AI-authored code under an opaque origin. The controls a
  // viewer uses to judge a game must never sit inside the thing they judge.
  // Asserted on `srcdoc`, since `Node.contains` cannot see into a frame.
  it('keeps the rating controls out of the sandboxed document', async () => {
    stubFetch({ manifest: () => jsonResponse(MANIFEST) });
    render(<App />);

    const rate = await screen.findByRole('button', { name: /^like$/i });
    const frame = screen.getByTitle(MANIFEST.title);
    const sandboxed = frame.getAttribute('srcdoc') ?? '';

    // The bundle reaches the sandbox exactly as it was fetched.
    expect(sandboxed).toBe(BUNDLE);
    expect(sandboxed).not.toMatch(/like|dislike/i);
    // The controls live in the parent document.
    expect(document.body.contains(rate)).toBe(true);
  });

  it('offers no rating controls before a game has loaded', () => {
    stubFetch({ manifest: () => jsonResponse(null) });
    render(<App />);

    expect(screen.queryByRole('group', { name: /rate this game/i })).toBeNull();
  });
});
