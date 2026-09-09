import { useReducer } from 'react';
import type { ByokModelsConfig } from '#lib/byok-config-types.ts';
import { type ByokProvider, isByokProvider } from '#lib/byok-config-types.ts';
import { useByokActions } from '@/features/byok/state/context/useByokActions.ts';
import { useByokStatus } from '@/features/byok/state/context/useByokStatus.ts';
import { initialByokForm, reduceByokForm } from '@/features/byok/state/helpers/byokForm.ts';
import { reportError } from '@/lib/sentry.ts';
import { FIELD_CONTROL, FormField } from '@/shared_components/FormField.tsx';
import { PillButton } from '@/shared_components/PillButton.tsx';

export interface ByokFormProps {
  /** Overridden in tests; defaults to the config this site shipped with. */
  readonly catalogue: ByokModelsConfig;
  /** Called when the visitor first reaches for the form, to warm the prompt. */
  readonly onEngage: () => void;
  /**
   * The prompt this run should send, composed by the panel — which is the
   * only place that knows whether the visitor asked to include the current
   * game.
   *
   * @returns `null` when the archived prompt could not be loaded, in which
   *   case there is nothing to send and the run does not start.
   */
  readonly composePrompt: () => Promise<string | null>;
}

function firstModelId(catalogue: ByokModelsConfig, provider: ByokProvider): string {
  return catalogue.find((entry) => entry.provider === provider)?.models[0]?.id ?? '';
}

/**
 * Picks a provider, a model and a key, and runs one generation with them.
 *
 * The key lives only in this component's own state, read once inside the
 * submit handler and cleared immediately after a success — it never reaches
 * `useByok`'s state, and never leaves this file except as one request.
 */
export function ByokForm({ catalogue, onEngage, composePrompt }: ByokFormProps) {
  const status = useByokStatus();
  const { clearFeedback, generate, stop, showResult } = useByokActions();
  // Lazy: the initial value is a scan of the catalogue, and a non-lazy
  // initializer runs that scan on every render to discard the result.
  const [{ provider, modelId, apiKey }, dispatch] = useReducer(
    reduceByokForm,
    catalogue,
    initialByokForm,
  );

  // One lookup, not three: the entry answers both what to list and what to label.
  const selected = catalogue.find((entry) => entry.provider === provider);
  const models = selected?.models ?? [];
  const generating = status.status === 'streaming';
  const canSubmit = apiKey.length > 0 && modelId.length > 0 && !generating;

  // A correction describes what the last model got wrong; it is addressed to
  // nobody once a different one is picked. Both handlers clear it, because
  // both land on a different model.
  const handleModelChange = (nextModelId: string): void => {
    dispatch({ type: 'model', modelId: nextModelId });
    clearFeedback();
  };

  const handleProviderChange = (nextProvider: ByokProvider): void => {
    dispatch({
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
      const userPrompt = await composePrompt();
      if (userPrompt === null) return;

      const generated = await generate({
        provider,
        modelId,
        providerLabel: selected?.label ?? provider,
        apiKey,
        userPrompt,
      });
      // Kept on a failure so Generate still works: a run that did not produce
      // a game is one the visitor will want to retry, and clearing the field
      // would leave them with a control they cannot use. Cleared on success,
      // and never written anywhere but this input either way.
      if (generated === null) return;
      dispatch({ type: 'apiKey', apiKey: '' });

      showResult({
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

  return (
    // Warmed when the visitor first reaches for the form, so the await in
    // handleSubmit has almost always already resolved.
    <div className="mt-3 flex flex-wrap items-end gap-2" onFocusCapture={onEngage}>
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
          onChange={(e) => dispatch({ type: 'apiKey', apiKey: e.target.value })}
          autoComplete="off"
          className={FIELD_CONTROL}
        />
      </FormField>

      <div className="flex items-center gap-2">
        {/* The spinner sits over the button rather than beside it, so the
            control the visitor just pressed is what shows it is working.
            Wrapping only the button makes the overlay take the button's own
            box, which a fixed width would not: the label changes with the
            state and a guessed width lands off centre. */}
        <span className="relative inline-flex">
          <PillButton tone="strong" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {/* Transparent rather than `invisible` or removed: the button
                keeps its width so nothing shifts, and it keeps its accessible
                name, which `visibility: hidden` would strip — leaving a
                disabled, unnamed button. */}
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
  );
}
