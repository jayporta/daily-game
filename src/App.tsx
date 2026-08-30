import { useEffect, useState } from 'react';
import { Centered } from './components/Centered.tsx';
import { GameFrame } from './components/GameFrame.tsx';
import { ControlLegend } from './components/ControlLegend.tsx';
import { GameMeta } from './components/GameMeta.tsx';
import { ReactionBar } from './components/ReactionBar.tsx';
import { ThemeToggle } from './components/ThemeToggle.tsx';
import { fetchGameHtml, fetchManifest } from './lib/manifest-client.ts';
import type { Manifest } from '../lib/types.ts';

/**
 * What the viewer is showing. `empty` is a normal state, not a failure:
 * the seed manifest is `null` until the pipeline first publishes.
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; manifest: Manifest; html: string };

/** Loads the day's manifest and bundle, then hands the bundle to the sandbox. */
export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const manifest = await fetchManifest();
        if (cancelled) return;
        if (!manifest) {
          setState({ status: 'empty' });
          return;
        }
        const html = await fetchGameHtml(manifest.path);
        if (cancelled) return;
        setState({ status: 'ready', manifest, html });
      } catch (error) {
        if (cancelled) return;
        setState({ status: 'error', message: (error as Error).message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        {state.status === 'ready' ? (
          <GameMeta manifest={state.manifest} />
        ) : (
          <h1 className="text-base font-semibold">Daily Game</h1>
        )}
        {/* Site chrome, so it is offered in every state — including the seed
            state, where there is no game to theme around. */}
        <ThemeToggle />
      </header>

      <main className="min-h-0 flex-1">
        {state.status === 'loading' && <Centered>Loading today&rsquo;s game&hellip;</Centered>}
        {state.status === 'empty' && (
          <Centered>
            No game has been published yet. Run <code className="mx-1">npm run dry-run</code> to
            generate one locally.
          </Centered>
        )}
        {state.status === 'error' && <Centered>Could not load today&rsquo;s game: {state.message}</Centered>}
        {state.status === 'ready' && <GameFrame html={state.html} title={state.manifest.title} />}
      </main>

      {/* One strip directly under the frame: what the game listens for on the
          left, the rating on the right. Both are outside the frame, and the
          rating must stay that way — it must not be reachable by the
          AI-authored code it rates. See ReactionBar's own note. */}
      {state.status === 'ready' && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2 border-t border-slate-200 px-4 py-2 dark:border-slate-800">
          <ControlLegend controls={state.manifest.controls} />
          <ReactionBar slug={state.manifest.slug} />
        </div>
      )}

      <footer className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
        A new game, invented by AI, every day. Built by Jason Matthew Porta ·{' '}
        <a
          className="underline hover:text-slate-900 dark:hover:text-slate-300"
          href="https://github.com/jayporta/daily-game"
        >
          source
        </a>
      </footer>
    </div>
  );
}
