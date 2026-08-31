import { useEffect, useState } from 'react';
import { Centered } from './ui/Centered.tsx';
import { CodeChip } from './ui/CodeChip.tsx';
import { GameFrame } from './features/game/GameFrame.tsx';
import { GitHubLink } from './ui/GitHubLink.tsx';
import { ControlLegend } from './features/game/ControlLegend.tsx';
import { GameFacts } from './features/game/GameFacts.tsx';
import { GameTitle } from './features/game/GameTitle.tsx';
import { ReactionBar } from './features/reaction/ReactionBar.tsx';
import { ThemeToggle } from './features/theme/ThemeToggle.tsx';
import { ByokPanel, type ByokResult } from './features/byok/ByokPanel.tsx';
import { PillButton } from './ui/PillButton.tsx';
import { fetchText, fetchManifest } from './features/game/manifest-client.ts';
import { errorMessage } from '../lib/errors.ts';
import { SYSTEM_PROMPT } from '../lib/system-prompt.ts';
import type { Manifest } from '../lib/manifest.ts';

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
  const [promptText, setPromptText] = useState<string | null>(null);
  const [byokOverride, setByokOverride] = useState<ByokResult | null>(null);

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
        setState({ status: 'error', message: errorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The exact prompt that produced today's game — see BYOK. Not fatal:
  // the game itself has already loaded by the time this fires, so a
  // failure here just leaves the panel's Generate button disabled.
  const promptPath = state.status === 'ready' ? state.manifest.promptPath : null;
  useEffect(() => {
    if (promptPath === null) return;
    let cancelled = false;
    // A safety net, not a live guard: `state` is set once by the effect
    // above and never again, so `promptPath` only ever changes once per
    // mount (loading → ready) — there is no in-app day rollover for a
    // pending generation to race against.
    setByokOverride(null);

    fetchText(promptPath)
      .then((text) => {
        if (!cancelled) setPromptText(text);
      })
      .catch(() => {
        if (!cancelled) setPromptText(null);
      });

    return () => {
      cancelled = true;
    };
  }, [promptPath]);

  return (
    <div className="min-h-dvh bg-surface font-sans text-title dark:bg-slate-950 dark:text-slate-100">
      {/* Wraps as one unit at narrow widths: the title block drops onto its
          own line and the controls follow underneath, both left-aligned,
          because a lone item on a wrapped row sits at the row's start. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline bg-panel px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-xl font-bold">Daily Game</span>
          <span className="text-ui text-meta dark:text-slate-400">
            A new game randomly AI-generated every day
          </span>
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
          <>
            <GameFrame
              html={byokOverride?.html ?? state.html}
              title={byokOverride?.title ?? state.manifest.title}
            />

            <div className="mt-3 rounded-xl border border-hairline bg-panel px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
              {/* `items-start` so a wrapped title does not drag the rating
                  controls down with it. */}
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                {byokOverride ? (
                  <h1 className="font-display text-2xl font-bold text-title dark:text-slate-100">
                    {byokOverride.title}
                  </h1>
                ) : (
                  <GameTitle manifest={state.manifest} />
                )}
                <ReactionBar slug={state.manifest.slug} />
              </div>

              <div className="mt-1">
                {byokOverride ? (
                  <p className="text-ui text-meta dark:text-slate-400">
                    Generated just now via{' '}
                    <CodeChip>
                      {byokOverride.providerLabel} · {byokOverride.modelId}
                    </CodeChip>
                  </p>
                ) : (
                  <GameFacts manifest={state.manifest} />
                )}
              </div>

              <div className="mt-4">
                <ControlLegend controls={state.manifest.controls} />
              </div>

              {byokOverride && (
                <div className="mt-4">
                  <PillButton tone="neutral" onClick={() => setByokOverride(null)}>
                    Back to today&rsquo;s game
                  </PillButton>
                </div>
              )}
            </div>

            <ByokPanel systemPrompt={SYSTEM_PROMPT} userPrompt={promptText} onResult={setByokOverride} />
          </>
        )}
      </main>
    </div>
  );
}
