import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactionConfig } from '#lib/reaction-types.ts';
import { DISLIKE_REASONS } from '#lib/reaction-types.ts';
import { ReactionBar } from '@/features/reaction/ReactionBar.tsx';

const SLUG = '2026-08-29-beetle';
const UNCONFIGURED: ReactionConfig = { endpointUrl: null, anonKey: null };
const CONFIGURED: ReactionConfig = {
  endpointUrl: 'https://proj.supabase.co/rest/v1/reactions',
  anonKey: 'anon-key',
};

function okFetch(): typeof fetch {
  return vi.fn<typeof fetch>(async () => new Response('', { status: 201 }));
}

/** The single row sent by a `fetch` stub, parsed. */
function sentRow(fetchImpl: typeof fetch): unknown {
  const calls = vi.mocked(fetchImpl).mock.calls;
  return JSON.parse(String(calls[0]?.[1]?.body));
}

const like = (): HTMLElement => screen.getByRole('button', { name: /^like$/i });
const dislike = (): HTMLElement => screen.getByRole('button', { name: /^dislike$/i });

describe('ReactionBar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers the viewer both a like and a dislike', () => {
    render(<ReactionBar slug={SLUG} config={UNCONFIGURED} />);

    expect(like()).toBeVisible();
    expect(dislike()).toBeVisible();
  });

  it('confirms the feedback once the viewer likes the game', async () => {
    render(<ReactionBar slug={SLUG} config={UNCONFIGURED} />);

    await userEvent.click(like());

    expect(screen.getByText(/feedback sent/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^like$/i })).toBeNull();
  });

  it('asks what went wrong when the viewer dislikes the game', async () => {
    render(<ReactionBar slug={SLUG} config={UNCONFIGURED} />);

    await userEvent.click(dislike());

    for (const reason of DISLIKE_REASONS) {
      expect(screen.getByRole('checkbox', { name: reason.label })).toBeVisible();
    }
  });

  // The reasons hang below the button rather than taking a place in the
  // flow: opening them used to push the game's whole metadata card down.
  it('keeps the rating buttons in place while the reasons are open', async () => {
    render(<ReactionBar slug={SLUG} config={UNCONFIGURED} />);

    await userEvent.click(dislike());

    expect(dislike()).toBeVisible();
    expect(like()).toBeVisible();
  });

  // Nothing else can close the panel without committing a dislike, and a
  // viewer who opened it by accident should not have to rate the game.
  it('closes the reasons on Escape without rating the game', async () => {
    const fetchImpl = okFetch();
    render(<ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />);
    await userEvent.click(dislike());

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(dislike()).toBeVisible();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('closes the reasons when the viewer clicks away, without rating', async () => {
    const fetchImpl = okFetch();
    render(
      <div>
        <button type="button">elsewhere</button>
        <ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />
      </div>,
    );
    await userEvent.click(dislike());

    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still rates the game when the viewer sends from the open reasons', async () => {
    const fetchImpl = okFetch();
    render(<ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />);
    await userEvent.click(dislike());

    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(screen.getByText(/feedback sent/i)).toBeVisible();
    expect(fetchImpl).toHaveBeenCalled();
  });

  // The dislike is only committed on Send or Skip, so the reasons travel
  // with it in a single insert.
  it('sends nothing until the viewer finishes choosing reasons', async () => {
    const fetchImpl = okFetch();
    render(<ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />);

    await userEvent.click(dislike());

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('ticks every reason when the viewer picks all of the above', async () => {
    render(<ReactionBar slug={SLUG} config={UNCONFIGURED} />);
    await userEvent.click(dislike());

    await userEvent.click(screen.getByRole('checkbox', { name: /all of the above/i }));

    for (const reason of DISLIKE_REASONS) {
      expect(screen.getByRole('checkbox', { name: reason.label })).toBeChecked();
    }
  });

  it('unticks all of the above once a reason is cleared', async () => {
    render(<ReactionBar slug={SLUG} config={UNCONFIGURED} />);
    await userEvent.click(dislike());
    await userEvent.click(screen.getByRole('checkbox', { name: /all of the above/i }));

    await userEvent.click(screen.getByRole('checkbox', { name: DISLIKE_REASONS[0].label }));

    expect(screen.getByRole('checkbox', { name: /all of the above/i })).not.toBeChecked();
  });

  it('sends the chosen reasons with the dislike', async () => {
    const fetchImpl = okFetch();
    render(<ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />);
    await userEvent.click(dislike());

    await userEvent.click(screen.getByRole('checkbox', { name: DISLIKE_REASONS[0].label }));
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sentRow(fetchImpl)).toEqual({
      slug: SLUG,
      reaction: 'dislike',
      reasons: [DISLIKE_REASONS[0].id],
    });
  });

  it('lets the viewer dislike without giving a reason', async () => {
    const fetchImpl = okFetch();
    render(<ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />);
    await userEvent.click(dislike());

    await userEvent.click(screen.getByRole('button', { name: /skip/i }));

    expect(sentRow(fetchImpl)).toEqual({ slug: SLUG, reaction: 'dislike', reasons: [] });
  });

  it('records a like as a like', async () => {
    const fetchImpl = okFetch();
    render(<ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />);

    await userEvent.click(like());

    expect(sentRow(fetchImpl)).toEqual({ slug: SLUG, reaction: 'like', reasons: [] });
  });

  // Today's shipped state: the whole flow works, and the page contacts
  // nothing at all.
  it('contacts nothing when no store is configured', async () => {
    const fetchImpl = okFetch();
    render(<ReactionBar slug={SLUG} config={UNCONFIGURED} fetchImpl={fetchImpl} />);

    await userEvent.click(dislike());
    await userEvent.click(screen.getByRole('button', { name: /skip/i }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByText(/feedback sent/i)).toBeVisible();
  });

  it('sends no cookies and forces a preflight', async () => {
    const fetchImpl = okFetch();
    render(<ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />);

    await userEvent.click(like());

    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('never reads what the store sends back', async () => {
    const response = new Response('{"id": 1}', { status: 201 });
    const fetchImpl = vi.fn<typeof fetch>(async () => response);
    render(<ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />);

    await userEvent.click(like());

    expect(response.bodyUsed).toBe(false);
  });

  it('still confirms the feedback when the store is unreachable', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    render(<ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />);

    await userEvent.click(like());

    expect(screen.getByText(/feedback sent/i)).toBeVisible();
  });

  it('still shows the game as rated after the viewer returns', async () => {
    const first = render(<ReactionBar slug={SLUG} config={UNCONFIGURED} />);
    await userEvent.click(like());
    first.unmount();

    render(<ReactionBar slug={SLUG} config={UNCONFIGURED} />);

    expect(screen.getByText(/feedback sent/i)).toBeVisible();
  });

  it('does not carry a reaction over to the next day', async () => {
    const first = render(<ReactionBar slug={SLUG} config={UNCONFIGURED} />);
    await userEvent.click(like());
    first.unmount();

    render(<ReactionBar slug="2026-08-30-otter" config={UNCONFIGURED} />);

    expect(like()).toBeVisible();
  });

  // A tab left open across the daily changeover swaps the manifest in place
  // rather than remounting, so the previous game's reaction must not follow.
  it('resets when the game is replaced without a remount', async () => {
    const { rerender } = render(<ReactionBar slug={SLUG} config={UNCONFIGURED} />);
    await userEvent.click(dislike());

    rerender(<ReactionBar slug="2026-08-30-otter" config={UNCONFIGURED} />);

    expect(like()).toBeVisible();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('reports one reaction however many times the viewer clicks', async () => {
    const fetchImpl = okFetch();
    render(<ReactionBar slug={SLUG} config={CONFIGURED} fetchImpl={fetchImpl} />);

    await userEvent.click(like());
    await userEvent.click(screen.getByText(/feedback sent/i));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not send a reaction for a slug the pipeline could not have published', async () => {
    const fetchImpl = okFetch();
    render(<ReactionBar slug="../admin" config={CONFIGURED} fetchImpl={fetchImpl} />);

    await userEvent.click(like());

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
