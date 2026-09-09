import { useMemo, useState } from 'react';
import type { ByokModelsConfig } from '#lib/byok-config-types.ts';
import { ByokForm } from '@/features/byok/ByokForm.tsx';
import { useByokActions } from '@/features/byok/state/context/useByokActions.ts';
import { useByokStatus } from '@/features/byok/state/context/useByokStatus.ts';
import { byokModelsConfig } from '@/features/byok/state/helpers/byokCatalogue.ts';
import {
  type ByokPromptParts,
  composeByokPrompt,
} from '@/features/byok/state/helpers/composeByokPrompt.ts';
import { type PromptTextState, usePromptText } from '@/features/byok/state/usePromptText.ts';
import { Disclosure } from '@/shared_components/Disclosure.tsx';
import { ErrorText } from '@/shared_components/ErrorText.tsx';
import { Panel } from '@/shared_components/Panel.tsx';

export interface ByokPanelProps {
  /**
   * Where the exact prompt that produced today's published game is published.
   * Fetched on first engagement with this panel, not with the page — most
   * visitors never open it.
   */
  readonly promptPath: string;
  /**
   * The game currently on screen — today's, or the visitor's own once they
   * have generated one. Sent only when the visitor ticks the box asking for
   * it, which is what makes generating twice a refinement rather than a
   * restart.
   */
  readonly currentGameHtml: string;
  /** Overridden in tests; defaults to the config this site shipped with. */
  readonly catalogue?: ByokModelsConfig;
  /** Replaces global `fetch`; injected by tests. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * What the disclosure shows, including while there is nothing to show yet.
 *
 * Composed with the same additions `handleSubmit` sends, because the summary
 * above it promises the exact prompt — a second assembly here would be a
 * promise that drifts.
 */
function promptText(
  prompt: PromptTextState,
  additions: Omit<ByokPromptParts, 'basePrompt'>,
): string {
  switch (prompt.status) {
    case 'ready':
      return composeByokPrompt({ basePrompt: prompt.text, ...additions });
    case 'failed':
      return 'Could not load the prompt.';
    case 'unrequested':
    case 'loading':
      return 'Loading…';
  }
}

/**
 * Lets a visitor re-run today's exact prompt against their own API key and
 * model. Output here is not moderated or smoke-tested before it renders —
 * the same sandboxed iframe already required for the daily game is the
 * accepted safety boundary.
 *
 * The key lives only in this component's own input state, read once inside
 * the submit handler and cleared immediately after — it never reaches
 * `useByok`'s state.
 */
export function ByokPanel({
  promptPath,
  currentGameHtml,
  catalogue = byokModelsConfig,
  fetchImpl,
}: ByokPanelProps) {
  const { state: prompt, load: loadPrompt } = usePromptText(promptPath, fetchImpl);
  const status = useByokStatus();
  const { priorFailureFeedback } = useByokActions();
  const [includeCurrentGame, setIncludeCurrentGame] = useState(false);

  // What this run adds to the archived prompt. Shared by the disclosure and
  // the form's submission so the two cannot describe different requests.
  const additions = useMemo<Omit<ByokPromptParts, 'basePrompt'>>(
    () => ({ priorFailureFeedback, ...(includeCurrentGame ? { currentGameHtml } : {}) }),
    [priorFailureFeedback, includeCurrentGame, currentGameHtml],
  );

  // Concatenating the whole game onto the whole prompt, so it is held rather
  // than rebuilt: with "include the current game" ticked this is tens of
  // kilobytes, and the panel re-renders while a generation streams.
  const shownPrompt = useMemo(() => promptText(prompt, additions), [prompt, additions]);

  const composePrompt = async (): Promise<string | null> => {
    const basePrompt = await loadPrompt();
    return basePrompt === null ? null : composeByokPrompt({ basePrompt, ...additions });
  };

  // A malformed config/byok-models.json degrades the catalogue to empty. There
  // is nothing to pick from then, so the panel says nothing rather than
  // offering a pair of empty menus.
  if (catalogue.length === 0) return null;

  return (
    <Panel>
      <div className="text-ui">
        <h2 className="font-display text-lg font-semibold">Generate your own</h2>
        <p className="mt-1 text-meta dark:text-slate-400">
          Paste your own API key and re-run today&rsquo;s exact prompt against your own model. The
          key is read-only, used for that one request, and never stored anywhere (view source{' '}
          <a
            href="https://github.com/jayporta/daily-game/blob/main/src/features/byok/ByokPanel.tsx"
            className="underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            here)
          </a>
          . The result is not moderated before it renders; it runs in the same sandboxed frame as
          today&rsquo;s game.
        </p>

        <Disclosure
          summary="See the exact prompt this will send"
          onToggle={() => void loadPrompt()}
        >
          <pre className="max-h-48 overflow-auto rounded-lg bg-chip p-2 text-xs whitespace-pre-wrap dark:bg-slate-800">
            {shownPrompt}
          </pre>
        </Disclosure>

        <ByokForm
          catalogue={catalogue}
          onEngage={() => void loadPrompt()}
          composePrompt={composePrompt}
        />

        <label className="mt-3 flex w-fit items-center gap-2 text-meta dark:text-slate-400">
          <input
            type="checkbox"
            checked={includeCurrentGame}
            onChange={(e) => setIncludeCurrentGame(e.target.checked)}
            className="size-4"
          />
          Include the current game&rsquo;s code and ask for an improvement on it
        </label>

        {status.status === 'error' && <ErrorText layout="mt-2 block">{status.message}</ErrorText>}
      </div>
    </Panel>
  );
}
