import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ByokPanel } from '../ByokPanel.tsx';
import type { ByokModelsConfig } from '../../../../lib/byok-config-types.ts';
import {
  BYOK_COMPLETION,
  BYOK_HTML,
  completionResponse,
  jsonResponse,
} from '../../../lib/testFixtures.ts';

const CATALOGUE: ByokModelsConfig = [
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    models: [
      { id: 'or-a', label: 'OR Model A' },
      { id: 'or-b', label: 'OR Model B' },
    ],
  },
  { provider: 'anthropic', label: 'Anthropic', models: [{ id: 'claude-x', label: 'Claude X' }] },
  { provider: 'openai', label: 'OpenAI', models: [{ id: 'gpt-x', label: 'GPT X' }] },
  { provider: 'gemini', label: 'Gemini', models: [{ id: 'gemini-x', label: 'Gemini X' }] },
];

const PROMPT_PATH = 'games/archive/2026-08-29-beetle/prompt.txt';

/**
 * The panel makes two kinds of request now — the day's prompt, then the
 * provider — so a stub has to tell them apart.
 */
function routedFetch(provider: () => Response): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input) =>
    String(input).endsWith('prompt.txt') ? new Response('the prompt', { status: 200 }) : provider(),
  );
}

const generateButton = (): HTMLElement => screen.getByRole('button', { name: /generate/i });

describe('ByokPanel', () => {
  it('narrows the model list to the selected provider', async () => {
    render(
      <ByokPanel
        systemPrompt="system"
        promptPath={PROMPT_PATH}
        onResult={() => {}}
        catalogue={CATALOGUE}
        fetchImpl={routedFetch(() => jsonResponse({}))}
      />,
    );

    expect(screen.getByRole('option', { name: 'OR Model A' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Claude X' })).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText(/provider/i), 'Anthropic');

    expect(screen.getByRole('option', { name: 'Claude X' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'OR Model A' })).toBeNull();
  });

  it('disables Generate until a key is entered', async () => {
    render(
      <ByokPanel
        systemPrompt="system"
        promptPath={PROMPT_PATH}
        onResult={() => {}}
        catalogue={CATALOGUE}
        fetchImpl={routedFetch(() => jsonResponse({}))}
      />,
    );

    expect(generateButton()).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-test-key');

    expect(generateButton()).toBeEnabled();
  });

  it('disables Generate while the prompt has not loaded yet', () => {
    render(
      <ByokPanel
        systemPrompt="system"
        promptPath={PROMPT_PATH}
        onResult={() => {}}
        catalogue={CATALOGUE}
        fetchImpl={routedFetch(() => jsonResponse({}))}
      />,
    );

    expect(generateButton()).toBeDisabled();
  });

  it('clears the key input immediately after submitting', async () => {
    const fetchImpl = routedFetch(() => completionResponse(BYOK_COMPLETION));
    render(
      <ByokPanel
        systemPrompt="system"
        promptPath={PROMPT_PATH}
        onResult={() => {}}
        catalogue={CATALOGUE}
        fetchImpl={fetchImpl}
      />,
    );

    const keyInput = screen.getByLabelText(/api key/i);
    await userEvent.type(keyInput, 'sk-test-key');
    await userEvent.click(generateButton());

    expect(keyInput).toHaveValue('');
  });

  it('calls onResult with the extracted bundle on success', async () => {
    const fetchImpl = routedFetch(() => completionResponse(BYOK_COMPLETION));
    const onResult = vi.fn();
    render(
      <ByokPanel
        systemPrompt="system"
        promptPath={PROMPT_PATH}
        onResult={onResult}
        catalogue={CATALOGUE}
        fetchImpl={fetchImpl}
      />,
    );

    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-test-key');
    await userEvent.click(generateButton());

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({
          html: BYOK_HTML,
          title: 'Regenerated Title',
          providerLabel: 'OpenRouter',
          modelId: 'or-a',
        }),
      ),
    );
  });

  it('shows a plain error and allows retrying without auto-retrying itself', async () => {
    // Counts provider calls, to prove the panel does not retry on its own.
    let providerCalls = 0;
    const fetchImpl = routedFetch(() => {
      providerCalls += 1;
      return new Response('', { status: 401 });
    });
    render(
      <ByokPanel
        systemPrompt="system"
        promptPath={PROMPT_PATH}
        onResult={() => {}}
        catalogue={CATALOGUE}
        fetchImpl={fetchImpl}
      />,
    );

    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-test-key');
    await userEvent.click(generateButton());

    expect(await screen.findByText(/401/)).toBeVisible();
    expect(providerCalls).toBe(1);

    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-another-key');
    await userEvent.click(generateButton());

    await waitFor(() => expect(providerCalls).toBe(2));
  });
});
