import { useEffect, useState } from 'react';
import { Centered } from './components/Centered.tsx';
import { CodeChip } from './components/CodeChip.tsx';
import { GameFrame } from './components/GameFrame.tsx';
import { ControlLegend } from './components/ControlLegend.tsx';
import { GameMeta } from './components/GameMeta.tsx';
import { ReactionBar } from './components/ReactionBar.tsx';
import { ThemeToggle } from './components/ThemeToggle.tsx';
import { fetchGameHtml, fetchManifest } from './lib/manifest-client.ts';
import { errorMessage } from '../lib/errors.ts';
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
        setState({ status: 'error', message: errorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-surface font-sans text-title dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-start justify-between gap-4 border-b border-hairline bg-panel px-6 py-4.5 dark:border-slate-800 dark:bg-slate-900">
        {state.status === 'ready' ? (
          <GameMeta manifest={state.manifest} />
        ) : (
          <h1 className="font-display text-xl font-bold">Daily Game</h1>
        )}

        <ThemeToggle />
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center p-7">
        {state.status === 'loading' && <Centered>Loading today&rsquo;s game&hellip;</Centered>}
        {state.status === 'empty' && (
          <Centered>
            No game has been published yet. Run
            <span className="mx-1">
              <CodeChip>npm run generate:local</CodeChip>
            </span>
            to generate one locally.
          </Centered>
        )}
        {state.status === 'error' && <Centered>Could not load today&rsquo;s game: {state.message}</Centered>}
        {state.status === 'ready' && <GameFrame html={state.html} title={state.manifest.title} />}
      </main>

      {state.status === 'ready' && (
        <div className="flex flex-wrap items-start gap-x-7 gap-y-4 border-t border-hairline bg-panel px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
          <ControlLegend controls={state.manifest.controls} />
          <ReactionBar slug={state.manifest.slug} />
        </div>
      )}

      <footer className="px-6 py-2.5 text-xs text-faint dark:text-slate-500">
        A new game, invented by AI, every day. Built by Jason Matthew Porta ·{' '}
        <a
          className="text-label hover:underline dark:text-slate-400"
          href="https://github.com/jayporta/daily-game"
        >
          source
        </a>
      </footer>
    </div>
  );
}
