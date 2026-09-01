import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ByokPanel, type ByokPanelProps } from '@/features/byok/ByokPanel.tsx';
import { useByok } from '@/features/byok/useByok.ts';
import type { ByokModelsConfig } from '#lib/byok-config-types.ts';
import {
  BYOK_COMPLETION,
  BYOK_HTML,
  completionResponse,
  jsonResponse,
  truncatedCompletionResponse,
} from '@/lib/testFixtures.ts';

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

/** Stands in for whatever game the page is showing above the panel. */
const CURRENT_GAME = '<!doctype html><body>todays game</body>';

/**
 * The panel makes two kinds of request now — the day's prompt, then the
 * provider — so a stub has to tell them apart.
 */
function routedFetch(provider: () => Response): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input) =>
    String(input).endsWith('prompt.txt') ? new Response('the prompt', { status: 200 }) : provider(),
  );
}

/**
 * The panel with a real generation hook behind it.
 *
 * The hook lives in `App` in production, because its live output renders
 * above this panel. Standing one up here keeps these tests exercising the
 * genuine request path rather than a hand-written stub of it.
 */
function PanelWithByok({
  currentGameHtml = CURRENT_GAME,
  ...props
}: Omit<ByokPanelProps, 'byok' | 'currentGameHtml'> & { currentGameHtml?: string }) {
  const byok = useByok({ systemPrompt: 'system', fetchImpl: props.fetchImpl });
  return <ByokPanel byok={byok} currentGameHtml={currentGameHtml} {...props} />;
}

const generateButton = (): HTMLElement => screen.getByRole('button', { name: /generate/i });

describe('ByokPanel', () => {
  it('narrows the model list to the selected provider', async () => {
    render(
      <PanelWithByok
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

  // The list narrowing above does not prove this: a stale model id survives a
  // provider change invisibly, because the `<select>` simply shows nothing
  // selected while the request still carries the old provider's model.
  it('sends the new provider a model that provider has', async () => {
    const fetchImpl = routedFetch(() => completionResponse(BYOK_COMPLETION));
    render(
      <PanelWithByok
        promptPath={PROMPT_PATH}
        onResult={() => {}}
        catalogue={CATALOGUE}
        fetchImpl={fetchImpl}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText(/provider/i), 'Anthropic');
    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-test-key');
    await userEvent.click(generateButton());

    await waitFor(() => {
      const providerCall = fetchImpl.mock.calls.find(
        ([input]) => !String(input).endsWith('prompt.txt'),
      );
      expect(String(providerCall?.[1]?.body)).toContain('claude-x');
    });
  });

  it('disables Generate until a key is entered', async () => {
    render(
      <PanelWithByok
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
      <PanelWithByok
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
      <PanelWithByok
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
      <PanelWithByok
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
      <PanelWithByok
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

describe('ByokPanel prompt composition', () => {
  /** Every provider request body the panel sent, oldest first. */
  function providerBodies(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>): string[] {
    return fetchImpl.mock.calls
      .filter(([url]) => String(url).startsWith('http'))
      .map(([, init]) => String(JSON.parse(String(init?.body)).messages[1].content));
  }

  /** A fetch answering the prompt request, then each provider response in turn. */
  function queuedFetch(responses: Response[]): ReturnType<typeof vi.fn<typeof fetch>> {
    const queue = [...responses];
    return vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('prompt.txt')
        ? new Response('the prompt', { status: 200 })
        : (queue.shift() ?? new Response('', { status: 500 })),
    );
  }

  async function generateOnce(): Promise<void> {
    await userEvent.type(screen.getByLabelText(/api key/i), 'sk-test-key');
    await userEvent.click(generateButton());
  }

  it('sends the current game only when the visitor asks for it', async () => {
    const fetchImpl = queuedFetch([completionResponse(BYOK_COMPLETION)]);
    render(
      <PanelWithByok promptPath={PROMPT_PATH} onResult={() => {}} catalogue={CATALOGUE} fetchImpl={fetchImpl} />,
    );

    await generateOnce();

    await waitFor(() => expect(providerBodies(fetchImpl)).toHaveLength(1));
    expect(providerBodies(fetchImpl)[0]).not.toContain(CURRENT_GAME);
  });

  it('sends the current game when the box is ticked', async () => {
    const fetchImpl = queuedFetch([completionResponse(BYOK_COMPLETION)]);
    render(
      <PanelWithByok promptPath={PROMPT_PATH} onResult={() => {}} catalogue={CATALOGUE} fetchImpl={fetchImpl} />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /include the current game/i }));
    await generateOnce();

    await waitFor(() => expect(providerBodies(fetchImpl)[0]).toContain(CURRENT_GAME));
  });

  // The summary promises "the exact prompt this will send". Composing it in
  // two places is how that promise quietly stops being true.
  it('shows the visitor exactly the prompt it sends', async () => {
    const fetchImpl = queuedFetch([completionResponse(BYOK_COMPLETION)]);
    render(
      <PanelWithByok promptPath={PROMPT_PATH} onResult={() => {}} catalogue={CATALOGUE} fetchImpl={fetchImpl} />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /include the current game/i }));
    await userEvent.click(screen.getByText(/see the exact prompt/i));
    const shown = await screen.findByText(/improve on the game below/i);

    await generateOnce();

    await waitFor(() => expect(providerBodies(fetchImpl)).toHaveLength(1));
    expect(providerBodies(fetchImpl)[0]).toBe(shown.textContent);
  });

  it('tells the next attempt why the last one failed', async () => {
    const fetchImpl = queuedFetch([truncatedCompletionResponse(), completionResponse(BYOK_COMPLETION)]);
    render(
      <PanelWithByok promptPath={PROMPT_PATH} onResult={() => {}} catalogue={CATALOGUE} fetchImpl={fetchImpl} />,
    );

    await generateOnce();
    await screen.findByRole('alert');
    await userEvent.click(generateButton());

    await waitFor(() => expect(providerBodies(fetchImpl)).toHaveLength(2));
    expect(providerBodies(fetchImpl)[0]).not.toMatch(/cut off/i);
    expect(providerBodies(fetchImpl)[1]).toMatch(/cut off/i);
  });

  // The correction describes what one model did. Carrying it to a model that
  // has not tried yet would have it fixing a mistake it never made.
  it('drops the correction when the visitor picks a different model', async () => {
    const fetchImpl = queuedFetch([truncatedCompletionResponse(), completionResponse(BYOK_COMPLETION)]);
    render(
      <PanelWithByok promptPath={PROMPT_PATH} onResult={() => {}} catalogue={CATALOGUE} fetchImpl={fetchImpl} />,
    );

    await generateOnce();
    await screen.findByRole('alert');
    await userEvent.selectOptions(screen.getByLabelText(/model/i), 'OR Model B');
    await userEvent.click(generateButton());

    await waitFor(() => expect(providerBodies(fetchImpl)).toHaveLength(2));
    expect(providerBodies(fetchImpl)[1]).not.toMatch(/cut off/i);
  });

  it('explains a truncated response instead of blaming the model', async () => {
    const fetchImpl = queuedFetch([truncatedCompletionResponse()]);
    render(
      <PanelWithByok promptPath={PROMPT_PATH} onResult={() => {}} catalogue={CATALOGUE} fetchImpl={fetchImpl} />,
    );

    await generateOnce();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/ran out of room/i);
    expect(alert).not.toHaveTextContent(/different model/i);
  });
});
