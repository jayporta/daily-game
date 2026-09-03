import { useReducer, useState } from 'react';
import {
  type ByokModelsConfig,
  type ByokProvider,
  isByokProvider,
} from '#lib/byok-config-types.ts';
import type { ControlHint } from '#lib/extract-bundle-shared.ts';
import { byokModelsConfig } from '@/features/byok/byokCatalogue.ts';
import { type ByokPromptParts, composeByokPrompt } from '@/features/byok/composeByokPrompt.ts';
import { FIELD_CONTROL, FormField } from '@/features/byok/FormField.tsx';
import type { UseByokResult } from '@/features/byok/useByok.ts';
import { type PromptTextState, usePromptText } from '@/features/byok/usePromptText.ts';
import { reportError } from '@/lib/sentry.ts';
import { Disclosure } from '@/shared_components/Disclosure.tsx';
import { Panel } from '@/shared_components/Panel.tsx';
import { PillButton } from '@/shared_components/PillButton.tsx';

export interface ByokResult {
  readonly html: string;
  readonly title: string;
  /**
   * The regenerated game's own controls — not the day's. The legend describes
   * whatever game is in the frame, and a BYOK game invents its own scheme.
   */
  readonly controls: readonly ControlHint[];
  readonly providerLabel: string;
  readonly modelId: string;
}

export interface ByokPanelProps {
  /**
   * The generation the page is running. Owned above this panel because the
   * live output renders in the game's place, which this panel sits under.
   */
  readonly byok: UseByokResult;
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
  /** Called with the regenerated bundle on success. */
  readonly onResult: (result: ByokResult) => void;
  /** Overridden in tests; defaults to the config this site shipped with. */
  readonly catalogue?: ByokModelsConfig;
  /** Replaces global `fetch`; injected by tests. */
  readonly fetchImpl?: typeof fetch;
}

function firstModelId(catalogue: ByokModelsConfig, provider: ByokProvider): string {
  return catalogue.find((entry) => entry.provider === provider)?.models[0]?.id ?? '';
}

/** Which provider and model this run will use. */
interface Selection {
  readonly provider: ByokProvider;
  readonly modelId: string;
}

/**
 * A provider carries its model with it, because a provider left beside
 * another provider's model would describe a request no catalogue entry
 * covers. The action supplies both, so the pair cannot be moved by halves.
 */
type SelectionAction =
  | { type: 'provider'; provider: ByokProvider; modelId: string }
  | { type: 'model'; modelId: string };

function reduceSelection(selection: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'provider':
      return { provider: action.provider, modelId: action.modelId };
    case 'model':
      return { provider: selection.provider, modelId: action.modelId };
  }
}

/**
 * The first entry in the catalogue.
 *
 * The `?? 'openrouter'` is unreachable past the empty-catalogue guard in the
 * panel; it is there because the type has no empty case.
 */
function initialSelection(catalogue: ByokModelsConfig): Selection {
  return {
    provider: catalogue[0]?.provider ?? 'openrouter',
    modelId: catalogue[0]?.models[0]?.id ?? '',
  };
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
  byok,
  promptPath,
  currentGameHtml,
  onResult,
  catalogue = byokModelsConfig,
  fetchImpl,
}: ByokPanelProps) {
  const { state: prompt, load: loadPrompt } = usePromptText(promptPath, fetchImpl);
  const { status, priorFailureFeedback, clearFeedback, generate, stop } = byok;
  // Lazy: the initial value is a scan of the catalogue, and a non-lazy
  // initializer runs that scan on every render to discard the result.
  const [{ provider, modelId }, select] = useReducer(reduceSelection, catalogue, initialSelection);
  const [apiKey, setApiKey] = useState('');
  const [includeCurrentGame, setIncludeCurrentGame] = useState(false);

  // One lookup, not three: the entry answers both what to list and what to label.
  const selected = catalogue.find((entry) => entry.provider === provider);
  const models = selected?.models ?? [];
  const generating = status.status === 'streaming';
  const canSubmit = apiKey.length > 0 && modelId.length > 0 && !generating;

  // What this run adds to the archived prompt. Shared by the disclosure and
  // the submit handler so the two cannot describe different requests.
  const additions = {
    priorFailureFeedback,
    ...(includeCurrentGame ? { currentGameHtml } : {}),
  };

  // A correction describes what the last model got wrong; it is addressed to
  // nobody once a different one is picked. Both handlers clear it, because
  // both land on a different model.
  const handleModelChange = (nextModelId: string): void => {
    select({ type: 'model', modelId: nextModelId });
    clearFeedback();
  };

  const handleProviderChange = (nextProvider: ByokProvider): void => {
    select({
      type: 'provider',
      provider: nextProvider,
      modelId: firstModelId(catalogue, nextProvider),
    });
    clearFeedback();
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;

    try {
      // Awaited rather than gating the button: warmed on first contact with
      // the panel, so this has almost always already resolved.
      const basePrompt = await loadPrompt();
      if (basePrompt === null) return;

      const generated = await generate({
        provider,
        modelId,
        providerLabel: selected?.label ?? provider,
        apiKey,
        userPrompt: composeByokPrompt({ basePrompt, ...additions }),
      });
      // Kept on a failure so Generate still works: a run that did not produce
      // a game is one the visitor will want to retry, and clearing the field
      // would leave them with a control they cannot use. Cleared on success,
      // and never written anywhere but this input either way.
      if (generated === null) return;
      setApiKey('');

      onResult({
        html: generated.html,
        title: generated.meta.title,
        controls: generated.meta.controls,
        providerLabel: generated.providerLabel,
        modelId: generated.modelId,
      });
    } catch (error) {
      // Fired as `void handleSubmit()`, so anything escaping here would be an
      // unhandled rejection and nothing else. `generate` reports its own
      // failures; this covers the handing-over on either side of it.
      reportError(error, { area: 'byok', stage: 'submit' });
      stop();
    }
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
            {promptText(prompt, additions)}
          </pre>
        </Disclosure>

        {/* Warmed when the visitor first reaches for the form, so the await in
            handleSubmit has almost always already resolved. */}
        <div
          className="mt-3 flex flex-wrap items-end gap-2"
          onFocusCapture={() => void loadPrompt()}
        >
          <FormField label="Provider">
            <select
              value={provider}
              onChange={(e) => {
                if (isByokProvider(e.target.value)) handleProviderChange(e.target.value);
              }}
              className={FIELD_CONTROL}
            >
              {catalogue.map((entry) => (
                <option key={entry.provider} value={entry.provider}>
                  {entry.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Model">
            <select
              value={modelId}
              onChange={(e) => handleModelChange(e.target.value)}
              className={FIELD_CONTROL}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="API key">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              className={FIELD_CONTROL}
            />
          </FormField>

          <div className="flex items-center gap-2">
            {/* The spinner sits over the button rather than beside it, so
                the control the visitor just pressed is what shows it is
                working. Wrapping only the button makes the overlay take the
                button's own box, which a fixed width would not: the label
                changes with the state and a guessed width lands off centre. */}
            <span className="relative inline-flex">
              <PillButton tone="strong" onClick={() => void handleSubmit()} disabled={!canSubmit}>
                {/* Transparent rather than `invisible` or removed: the
                    button keeps its width so nothing shifts, and it keeps its
                    accessible name, which `visibility: hidden` would strip —
                    leaving a disabled, unnamed button. */}
                <span className={generating ? 'text-transparent' : undefined}>Generate</span>
              </PillButton>

              {generating && (
                <span
                  role="status"
                  aria-label="Generating"
                  className="pointer-events-none absolute inset-0 grid place-items-center"
                >
                  <span className="size-4 animate-spin rounded-full border-2 border-body border-t-transparent dark:border-slate-100 dark:border-t-transparent" />
                </span>
              )}
            </span>

            {generating && (
              <PillButton tone="neutral" onClick={stop}>
                Stop
              </PillButton>
            )}
          </div>
        </div>

        <label className="mt-3 flex w-fit items-center gap-2 text-meta dark:text-slate-400">
          <input
            type="checkbox"
            checked={includeCurrentGame}
            onChange={(e) => setIncludeCurrentGame(e.target.checked)}
            className="size-4"
          />
          Include the current game&rsquo;s code and ask for an improvement on it
        </label>

        {/* No `text-meta` here: it is a colour, not a size, and a second
            colour utility beside `text-rose-600` would silently lose. The
            size comes from `text-ui` on the wrapper above. */}
        {status.status === 'error' && (
          <p role="alert" className="mt-2 text-rose-600 dark:text-rose-400">
            {status.message}
          </p>
        )}
      </div>
    </Panel>
  );
}
