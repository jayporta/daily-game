import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App.tsx';
import type { Manifest } from '../lib/types.ts';

const MANIFEST: Manifest = {
  date: '2026-08-29',
  slug: '2026-08-29-beetle',
  path: 'games/archive/2026-08-29-beetle/game.html',
  title: 'Beetle of a Thousand Mirrors',
  genre: 'maze-adventure',
  model: 'qwen/qwen-2.5-72b-instruct:free',
  generatedAt: '2026-08-29T09:04:00.000Z',
  expiresAt: '2026-08-30T13:00:00.000Z',
};

const BUNDLE = '<!doctype html><html><body><canvas></canvas></body></html>';

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
    expect(screen.getByText('maze-adventure')).toBeVisible();
  });

  it('invites a local dry run when nothing has been published yet', async () => {
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
  it('keeps the rating controls outside the sandboxed frame', async () => {
    stubFetch({ manifest: () => jsonResponse(MANIFEST) });
    render(<App />);

    const rate = await screen.findByRole('button', { name: /^like$/i });
    const frame = screen.getByTitle(MANIFEST.title);

    expect(frame.tagName).toBe('IFRAME');
    expect(frame.contains(rate)).toBe(false);
  });

  it('offers no rating controls before a game has loaded', () => {
    stubFetch({ manifest: () => jsonResponse(null) });
    render(<App />);

    expect(screen.queryByRole('group', { name: /rate this game/i })).toBeNull();
  });
});
