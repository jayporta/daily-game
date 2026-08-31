import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.tsx';
import {
  BUNDLE,
  BYOK_COMPLETION,
  BYOK_HTML,
  MANIFEST,
  completionResponse,
  jsonResponse,
} from '../lib/testFixtures.ts';

/**
 * Stubs global fetch, routing manifest, bundle and prompt requests
 * separately so a test can fail one without the other.
 */
function stubFetch(handlers: {
  manifest: () => Response;
  game?: () => Response;
  prompt?: () => Response;
  /** Routed by absolute URL — the app's own fetches are always relative paths. */
  byokProvider?: () => Response;
}): ReturnType<typeof vi.fn> {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('manifest.json')) return handlers.manifest();
    if (url.endsWith('prompt.txt')) return handlers.prompt?.() ?? new Response('the prompt', { status: 200 });
    if (url.startsWith('http')) {
      return handlers.byokProvider?.() ?? new Response('', { status: 500 });
    }
    return handlers.game?.() ?? new Response(BUNDLE, { status: 200 });
  });
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
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

  // Most visitors never open the BYOK panel, so the prompt is not part of
  // loading the page. It used to be fetched on every visit.
  it('does not fetch the prompt until the visitor engages with the panel', async () => {
    const fetchImpl = stubFetch({ manifest: () => jsonResponse(MANIFEST) });
    render(<App />);
    await screen.findByTitle(MANIFEST.title);

    const promptRequests = () =>
      fetchImpl.mock.calls.filter(([url]: unknown[]) => String(url).endsWith('prompt.txt')).length;
    expect(promptRequests()).toBe(0);

    await userEvent.click(screen.getByText(/see the exact prompt/i));

    await waitFor(() => expect(promptRequests()).toBe(1));
  });

  it('shows the BYOK panel once the game is ready', async () => {
    stubFetch({ manifest: () => jsonResponse(MANIFEST) });
    render(<App />);

    expect(await screen.findByRole('button', { name: /generate/i })).toBeVisible();
  });

  // The panel exists to re-run the day's exact prompt. A game archived
  // before prompts were has none, so there is nothing to re-run.
  it('hides the BYOK panel for a game with no archived prompt', async () => {
    const { promptPath: _omitted, ...withoutPrompt } = MANIFEST;
    stubFetch({ manifest: () => jsonResponse(withoutPrompt) });
    render(<App />);

    await screen.findByTitle(MANIFEST.title);
    expect(screen.queryByRole('button', { name: /generate/i })).toBeNull();
    expect(screen.queryByText(/see the exact prompt/i)).toBeNull();
  });

  it('a BYOK result replaces the iframe html/title without touching the original manifest state', async () => {
    stubFetch({
      manifest: () => jsonResponse(MANIFEST),
      byokProvider: () => completionResponse(BYOK_COMPLETION),
    });
    render(<App />);

    await screen.findByTitle(MANIFEST.title);
    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-test-key');
    await userEvent.click(screen.getByRole('button', { name: /generate/i }));

    const frame = await screen.findByTitle('Regenerated Title');
    expect(frame).toHaveAttribute('srcdoc', BYOK_HTML);
    expect(screen.getByRole('button', { name: /back to today/i })).toBeVisible();
  });

  // The legend describes whatever game is in the frame. It used to be wired
  // to the manifest unconditionally, so a BYOK game was played with the
  // published game's controls printed under it.
  it('describes the regenerated game\u2019s own controls, not the published game\u2019s', async () => {
    const withControls = BYOK_COMPLETION.replace(
      '"controls": []',
      '"controls": [{"action": "Fly", "key": "Space"}]',
    );
    stubFetch({
      manifest: () => jsonResponse(MANIFEST),
      byokProvider: () => completionResponse(withControls),
    });
    render(<App />);

    await screen.findByTitle(MANIFEST.title);
    expect(screen.getByText('Arrow keys')).toBeVisible();

    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-test-key');
    await userEvent.click(screen.getByRole('button', { name: /generate/i }));
    await screen.findByTitle('Regenerated Title');

    expect(screen.getByText('Space')).toBeVisible();
    expect(screen.queryByText('Arrow keys')).toBeNull();
  });

  it("back to today's game restores the original html/title with no new fetch", async () => {
    const fetchImpl = stubFetch({
      manifest: () => jsonResponse(MANIFEST),
      byokProvider: () => completionResponse(BYOK_COMPLETION),
    });
    render(<App />);

    await screen.findByTitle(MANIFEST.title);
    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-test-key');
    await userEvent.click(screen.getByRole('button', { name: /generate/i }));
    await screen.findByTitle('Regenerated Title');

    const callsBeforeBack = fetchImpl.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /back to today/i }));

    const frame = await screen.findByTitle(MANIFEST.title);
    expect(frame).toHaveAttribute('srcdoc', BUNDLE);
    expect(fetchImpl.mock.calls.length).toBe(callsBeforeBack);
  });
});
