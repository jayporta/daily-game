// The browser's half of the reaction path: what to send, where to keep the
// visitor's own choice, and how to send it without ever trusting what comes
// back. Free of React and of browser globals so it can be unit tested under
// `node --test` with a plain object for storage and a stubbed fetch.
//
// Two properties hold this together and are asserted by tests:
//
//   * Every failure is swallowed. The store is a free hobby-tier service and
//     `localStorage` throws outright in Safari's private mode; neither may
//     ever break the page or the game.
//   * The browser writes and never reads. Nothing from the store enters the
//     page, so there is no inbound path to escape or sanitise.
import {
  isDislikeReason,
  isPublishableSlug,
  type DislikeReason,
  type ReactionConfig,
  type ReactionKind,
  type ReactionPayload,
} from '../../../lib/reaction-types.ts';
import { isRecord } from '../../../lib/guards.ts';
import type { WebStorage } from '../../lib/browser-storage.ts';

/** A visitor's own recorded choice for one game. */
export interface StoredReaction {
  /** Which way they reacted. */
  readonly kind: ReactionKind;
  /** Always empty for a like; possibly empty for a dislike. */
  readonly reasons: readonly DislikeReason[];
}

/** A request ready to send, built by {@link buildInsertRequest}. */
export interface InsertRequest {
  /** The store's insert endpoint, taken verbatim from config. */
  readonly url: string;
  /** Carries this module's cross-origin posture — see {@link buildInsertRequest}. */
  readonly init: RequestInit;
}

/**
 * Builds the insert, or returns `null` when it must not be sent.
 *
 * The `RequestInit` is where this module's cross-origin posture lives:
 *
 * - `credentials: 'omit'` — the row authenticates with an explicit header,
 *   so no cookie should ever ride along with it.
 * - `Content-Type: application/json` — a non-simple header, so the request
 *   is always CORS-preflighted and can never be fired silently at the store
 *   by a cross-site form post.
 * - `referrerPolicy: 'no-referrer'` — the store's logs get no page URL.
 * - `Prefer: return=minimal` — ask for no row back, since none is read.
 *
 * @returns `null` when no store is configured, or when `slug` is not one
 *   this project could have published.
 */
export function buildInsertRequest(
  config: ReactionConfig,
  payload: ReactionPayload,
): InsertRequest | null {
  if (config.endpointUrl === null) return null;
  if (!isPublishableSlug(payload.slug)) return null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  if (config.anonKey !== null) {
    headers['apikey'] = config.anonKey;
    headers['Authorization'] = `Bearer ${config.anonKey}`;
  }

  return {
    url: config.endpointUrl,
    init: {
      method: 'POST',
      headers,
      credentials: 'omit',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      body: JSON.stringify({
        slug: payload.slug,
        reaction: payload.reaction,
        reasons: [...payload.reasons],
      }),
    },
  };
}

/** Injection point that lets {@link sendReaction} be tested without a network. */
export interface SendReactionOptions {
  /** Replaces global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Sends one reaction, fire and forget.
 *
 * The response is deliberately never read — not its body, not its status.
 * Nothing the store says can reach the page, which is what keeps the whole
 * inbound-XSS class out of this design rather than merely escaped.
 *
 * Resolves whatever happens, including when `request` is `null`.
 */
export async function sendReaction(
  request: InsertRequest | null,
  { fetchImpl = fetch }: SendReactionOptions = {},
): Promise<void> {
  if (request === null) return;
  try {
    await fetchImpl(request.url, request.init);
  } catch {
    // Unreachable store. Silently swallowed — a dead counter must never
    // surface to the viewer.
  }
}

function storageKey(slug: string): string {
  return `daily-game:reaction:${slug}`;
}

function toStoredReaction(value: unknown): StoredReaction | null {
  if (!isRecord(value)) return null;
  if (!('kind' in value) || !('reasons' in value)) return null;

  const { kind, reasons } = value;
  if (kind !== 'like' && kind !== 'dislike') return null;

  return {
    kind,
    reasons: Array.isArray(reasons) ? reasons.filter(isDislikeReason) : [],
  };
}

/**
 * This visitor's own choice for `slug`, or `null` if they have not reacted.
 *
 * The stored value is re-validated rather than trusted: GitHub Pages puts
 * every project site under one account on a single origin, so this store is
 * shared with any other site the owner publishes there.
 */
export function readReaction(storage: WebStorage | null, slug: string): StoredReaction | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(storageKey(slug));
    if (raw === null) return null;
    return toStoredReaction(JSON.parse(raw));
  } catch {
    // Unreadable or unparseable: treat as "has not reacted".
    return null;
  }
}

/** Records this visitor's choice for `slug`. Never throws. */
export function rememberReaction(
  storage: WebStorage | null,
  slug: string,
  reaction: StoredReaction,
): void {
  if (storage === null) return;
  try {
    storage.setItem(storageKey(slug), JSON.stringify(reaction));
  } catch {
    // An unwritable store costs the visitor a duplicate vote next visit.
    // Strictly better than a broken button.
  }
}
