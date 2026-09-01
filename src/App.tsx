import { useEffect, useState } from 'react';
import { Centered } from '@/shared_components/Centered.tsx';
import { CodeChip } from '@/shared_components/CodeChip.tsx';
import { MetaText } from '@/shared_components/MetaText.tsx';
import { GameView } from '@/features/game/GameView.tsx';
import { GitHubLink } from '@/shared_components/GitHubLink.tsx';
import { ThemeToggle } from '@/features/theme/ThemeToggle.tsx';
import { fetchText, fetchManifest } from '@/features/game/manifest-client.ts';
import { useByok } from '@/features/byok/useByok.ts';
import { reportError } from '@/lib/sentry.ts';
import type { ByokResult } from '@/features/byok/ByokPanel.tsx';
import { SYSTEM_PROMPT } from '#lib/system-prompt.ts';
import { errorMessage } from '#lib/errors.ts';
import type { Manifest } from '#lib/manifest.ts';

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
  const [byokOverride, setByokOverride] = useState<ByokResult | null>(null);
  // Owned here rather than in the panel: the live output renders in the
  // game's place, above the panel that starts it.
  const byok = useByok({ systemPrompt: SYSTEM_PROMPT });

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
        const html = await fetchText(manifest.path);
        if (cancelled) return;
        setState({ status: 'ready', manifest, html });
      } catch (error) {
        if (cancelled) return;
        // Turned into a message on screen, so no global handler ever sees it —
        // and a site that cannot load its own game is exactly the failure
        // worth being told about.
        reportError(error, { area: 'manifest' });
        setState({ status: 'error', message: errorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-surface font-sans text-title dark:bg-slate-950 dark:text-slate-100">
      {/* Wraps as one unit at narrow widths: the title block drops onto its
          own line and the controls follow underneath, both left-aligned,
          because a lone item on a wrapped row sits at the row's start. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline bg-panel px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-xl font-bold">Daily Game</span>
          <MetaText>A new game randomly AI-generated every day</MetaText>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-faint dark:text-slate-500">
            &copy;2026 Jason Matthew Porta
          </span>
          <GitHubLink />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-160 px-6 py-7">
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
        {state.status === 'error' && (
          <Centered>Could not load today&rsquo;s game: {state.message}</Centered>
        )}

        {state.status === 'ready' && (
          <GameView
            manifest={state.manifest}
            html={state.html}
            byokOverride={byokOverride}
            byok={byok}
            onByokResult={setByokOverride}
            onDismissByok={() => setByokOverride(null)}
          />
        )}
      </main>
    </div>
  );
}
