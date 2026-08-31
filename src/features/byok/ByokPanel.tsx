import { useState } from 'react';
import { PillButton } from '../../ui/PillButton.tsx';
import { useByok } from './useByok.ts';
import { byokModelsConfig } from './config.ts';
import { isByokProvider, type ByokModelsConfig, type ByokProvider } from '../../../lib/byok-config-types.ts';

export interface ByokResult {
  readonly html: string;
  readonly title: string;
  readonly providerLabel: string;
  readonly modelId: string;
}

export interface ByokPanelProps {
  /** The fixed system prompt, imported directly — never per-game. */
  readonly systemPrompt: string;
  /** The exact prompt that produced today's published game; `null` while it loads. */
  readonly userPrompt: string | null;
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
  userPrompt,
  onResult,
  catalogue = byokModelsConfig,
  fetchImpl,
}: ByokPanelProps) {
  const { status, generate, reset } = useByok({ systemPrompt, userPrompt: userPrompt ?? '', fetchImpl });
  const [provider, setProvider] = useState<ByokProvider>(catalogue[0]?.provider ?? 'openrouter');
  const [modelId, setModelId] = useState(firstModelId(catalogue, provider));
  const [apiKey, setApiKey] = useState('');

  const models = catalogue.find((entry) => entry.provider === provider)?.models ?? [];
  const canSubmit = userPrompt !== null && apiKey.length > 0 && modelId.length > 0 && status.status !== 'loading';

  const handleProviderChange = (nextProvider: ByokProvider): void => {
    setProvider(nextProvider);
    setModelId(firstModelId(catalogue, nextProvider));
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;

    const key = apiKey;
    setApiKey('');
    const providerLabel = catalogue.find((entry) => entry.provider === provider)?.label ?? provider;
    const result = await generate(provider, modelId, providerLabel, key);
    if (result.status === 'ready') {
      onResult({
        html: result.html,
        title: result.meta.title,
        providerLabel: result.providerLabel,
        modelId: result.modelId,
      });
      reset();
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-hairline bg-panel px-5 py-4 text-ui dark:border-slate-800 dark:bg-slate-900">
      <h2 className="font-display text-lg font-semibold">Generate your own</h2>
      <p className="mt-1 text-meta dark:text-slate-400">
        Paste your own API key and re-run today&rsquo;s exact prompt against your own model. The
        key is read only when you click Generate, used for that one request, and never stored —
        not in this browser, not anywhere else. See for yourself:{' '}
        <a
          href="https://github.com/jayporta/daily-game/blob/main/src/components/ByokPanel.tsx"
          className="underline"
        >
          this component&rsquo;s source
        </a>
        . The result is not moderated before it renders — it runs in the same sandboxed frame as
        today&rsquo;s game.
      </p>

      <details className="mt-2">
        <summary className="cursor-pointer text-meta dark:text-slate-400">
          See the exact prompt this will send
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-chip p-2 text-xs dark:bg-slate-800">
          {userPrompt ?? 'Loading…'}
        </pre>
      </details>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-label dark:text-slate-300">
          Provider
          <select
            value={provider}
            onChange={(e) => {
              if (isByokProvider(e.target.value)) handleProviderChange(e.target.value);
            }}
            className="rounded-lg border border-hairline bg-panel px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          >
            {catalogue.map((entry) => (
              <option key={entry.provider} value={entry.provider}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-label dark:text-slate-300">
          Model
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="rounded-lg border border-hairline bg-panel px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-label dark:text-slate-300">
          API key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            className="rounded-lg border border-hairline bg-panel px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        <PillButton tone="strong" onClick={() => void handleSubmit()} disabled={!canSubmit}>
          {status.status === 'loading' ? 'Generating…' : 'Generate'}
        </PillButton>
      </div>

      {status.status === 'error' && (
        <p className="mt-2 text-meta text-rose-600 dark:text-rose-400">{status.message}</p>
      )}
    </div>
  );
}
