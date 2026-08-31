import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ByokPanel } from '../ByokPanel.tsx';
import type { ByokModelsConfig } from '../../../../lib/byok-config-types.ts';

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

const VALID_COMPLETION = [
  '```json',
  '{"title": "Regenerated Title", "genre": "maze-adventure", "theme": "th", "mechanics": ["m"], "controls": []}',
  '```',
  '',
  '```html',
  '<!doctype html><html><body>better game</body></html>',
  '```',
].join('\n');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

const generateButton = (): HTMLElement => screen.getByRole('button', { name: /generate/i });

describe('ByokPanel', () => {
  it('narrows the model list to the selected provider', async () => {
    render(
      <ByokPanel
        systemPrompt="system"
        userPrompt="the prompt"
        onResult={() => {}}
        catalogue={CATALOGUE}
        fetchImpl={stubFetch(jsonResponse({}))}
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
        userPrompt="the prompt"
        onResult={() => {}}
        catalogue={CATALOGUE}
        fetchImpl={stubFetch(jsonResponse({}))}
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
        userPrompt={null}
        onResult={() => {}}
        catalogue={CATALOGUE}
        fetchImpl={stubFetch(jsonResponse({}))}
      />,
    );

    expect(generateButton()).toBeDisabled();
  });

  it('clears the key input immediately after submitting', async () => {
    const fetchImpl = stubFetch(
      jsonResponse({ choices: [{ message: { content: VALID_COMPLETION } }] }),
    );
    render(
      <ByokPanel
        systemPrompt="system"
        userPrompt="the prompt"
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
    const fetchImpl = stubFetch(
      jsonResponse({ choices: [{ message: { content: VALID_COMPLETION } }] }),
    );
    const onResult = vi.fn();
    render(
      <ByokPanel
        systemPrompt="system"
        userPrompt="the prompt"
        onResult={onResult}
        catalogue={CATALOGUE}
        fetchImpl={fetchImpl}
      />,
    );

    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-test-key');
    await userEvent.click(generateButton());

    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({
        html: '<!doctype html><html><body>better game</body></html>',
        title: 'Regenerated Title',
        providerLabel: 'OpenRouter',
        modelId: 'or-a',
      }),
    );
  });

  it('shows a plain error and allows retrying without auto-retrying itself', async () => {
    const fetchImpl = stubFetch(new Response('', { status: 401 }));
    render(
      <ByokPanel
        systemPrompt="system"
        userPrompt="the prompt"
        onResult={() => {}}
        catalogue={CATALOGUE}
        fetchImpl={fetchImpl}
      />,
    );

    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-test-key');
    await userEvent.click(generateButton());

    expect(screen.getByText(/401/)).toBeVisible();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-another-key');
    await userEvent.click(generateButton());

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
