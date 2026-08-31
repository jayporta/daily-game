import { useState } from 'react';
import { FIELD_CONTROL, FormField } from './FormField.tsx';
import { Panel } from '../../ui/Panel.tsx';
import { PillButton } from '../../ui/PillButton.tsx';
import { useByok } from './useByok.ts';
import { usePromptText, type PromptTextState } from './usePromptText.ts';
import { byokModelsConfig } from './byokCatalogue.ts';
import { isByokProvider, type ByokModelsConfig, type ByokProvider } from '../../../lib/byok-config-types.ts';
import type { ControlHint } from '../../../lib/extract-bundle-shared.ts';

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
  /** The fixed system prompt, imported directly — never per-game. */
  readonly systemPrompt: string;
  /**
   * Where the exact prompt that produced today's published game is published.
   * Fetched on first engagement with this panel, not with the page — most
   * visitors never open it.
   */
  readonly promptPath: string;
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

/** What the disclosure shows, including while there is nothing to show yet. */
function promptText(prompt: PromptTextState): string {
  switch (prompt.status) {
    case 'ready':
      return prompt.text;
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
  systemPrompt,
  promptPath,
  onResult,
  catalogue = byokModelsConfig,
  fetchImpl,
}: ByokPanelProps) {
  const { state: prompt, load: loadPrompt } = usePromptText(promptPath, fetchImpl);
  const { status, generate } = useByok({ systemPrompt, fetchImpl });
  // Lazy: both initial values are a scan of the catalogue, and a non-lazy
  // initializer runs that scan on every render to discard the result.
  // The `?? 'openrouter'` is unreachable past the empty-catalogue guard below;
  // it is there because the type has no empty case.
  const [provider, setProvider] = useState<ByokProvider>(() => catalogue[0]?.provider ?? 'openrouter');
  const [modelId, setModelId] = useState(() => catalogue[0]?.models[0]?.id ?? '');
  const [apiKey, setApiKey] = useState('');

  // One lookup, not three: the entry answers both what to list and what to label.
  const selected = catalogue.find((entry) => entry.provider === provider);
  const models = selected?.models ?? [];
  const canSubmit = apiKey.length > 0 && modelId.length > 0 && status.status !== 'loading';

  const handleProviderChange = (nextProvider: ByokProvider): void => {
    setProvider(nextProvider);
    setModelId(firstModelId(catalogue, nextProvider));
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;

    const key = apiKey;
    setApiKey('');
    // Awaited rather than gating the button: warmed on first contact with the
    // panel, so this has almost always already resolved.
    const userPrompt = await loadPrompt();
    if (userPrompt === null) return;

    const generated = await generate({
      provider,
      modelId,
      providerLabel: selected?.label ?? provider,
      apiKey: key,
      userPrompt,
    });
    if (generated === null) return;

    onResult({
      html: generated.html,
      title: generated.meta.title,
      controls: generated.meta.controls,
      providerLabel: generated.providerLabel,
      modelId: generated.modelId,
    });
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
          key is read only when you click Generate, used for that one request, and never stored —
          not in this browser, not anywhere else. See for yourself:{' '}
          <a
            href="https://github.com/jayporta/daily-game/blob/main/src/features/byok/ByokPanel.tsx"
            className="underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            this component&rsquo;s source
          </a>
          . The result is not moderated before it renders — it runs in the same sandboxed frame as
          today&rsquo;s game.
        </p>

        <details className="mt-2" onToggle={() => void loadPrompt()}>
          <summary className="cursor-pointer text-meta dark:text-slate-400">
            See the exact prompt this will send
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-chip p-2 text-xs dark:bg-slate-800">
            {promptText(prompt)}
          </pre>
        </details>

        {/* Warmed when the visitor first reaches for the form, so the await in
            handleSubmit has almost always already resolved. */}
        <div className="mt-3 flex flex-wrap items-end gap-2" onFocusCapture={() => void loadPrompt()}>
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
              onChange={(e) => setModelId(e.target.value)}
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

          <PillButton tone="strong" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {status.status === 'loading' ? 'Generating…' : 'Generate'}
          </PillButton>
        </div>

        {status.status === 'error' && (
          <p role="alert" className="mt-2 text-meta text-rose-600 dark:text-rose-400">
            {status.message}
          </p>
        )}
      </div>
    </Panel>
  );
}
