// The browser's half of the reaction path: what to send, where to keep the
// visitor's own choice, and how to send it without ever trusting what comes
// back. Free of React and of browser globals so it can be unit tested under
// `node --test` with a plain object for storage and a stubbed fetch.
//
// Two properties hold this together and are asserted by tests:
//
//   * A failure never breaks the page. The store is a free hobby-tier
//     service and `localStorage` throws outright in Safari's private mode;
//     neither may ever throw into the caller or the game. A refused insert is
//     reported to Sentry, never shown to the visitor.
//   * Nothing from the store enters the page, so there is no inbound path to
//     escape or sanitise.

import { isRecord } from '#lib/guards.ts';
import {
  type DislikeReason,
  isDislikeReason,
  isPublishableSlug,
  type ReactionConfig,
  type ReactionKind,
  type ReactionPayload,
} from '#lib/reactionTypes.ts';
import {
  type InsertRefusalTags,
  insertRefusalTags,
} from '#src/features/reaction/state/helpers/insertRefusal.ts';
import type { WebStorage } from '#src/lib/browserStorage.ts';
import type { ErrorTags, reportError } from '#src/lib/sentry.ts';

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
  /**
   * Receives each refused insert: an `Error` plus `area` and `kind` tags. The
   * app passes {@link reportError}.
   */
  report: typeof reportError;
}

/**
 * Sends one reaction, fire and forget.
 *
 * A reply the store sent and refused (`!response.ok`) is reported through
 * `report`, tagged `area: 'reaction'` and `kind: 'refused'`. Only then is the
 * body read, and only to pull a whitelisted error code and constraint name
 * out of it — see {@link insertRefusalTags}. A successful response never has
 * its body read. Nothing the store says can reach the page, which is what
 * keeps the whole inbound-XSS class out of this design rather than merely
 * escaped.
 *
 * A `fetch` that rejects is not reported: from the browser, a dead or
 * misconfigured store looks the same as a visitor who is offline or blocking
 * the request. The daily pipeline's store read reports that case instead.
 *
 * Resolves whatever happens, including when `request` is `null` or `report`
 * throws, so a dead counter never breaks the page or the game.
 */
export async function sendReaction(
  request: InsertRequest | null,
  { fetchImpl = fetch, report }: SendReactionOptions,
): Promise<void> {
  if (request === null) return;

  const failure = await insertFailure(request, fetchImpl);
  if (failure === null) return;
  try {
    report(failure.error, failure.tags);
  } catch {
    // A broken reporter still leaves the send resolved.
  }
}

/** What the store refused about one insert, or `null` when it accepted or was never reached. Never throws. */
async function insertFailure(
  request: InsertRequest,
  fetchImpl: typeof fetch,
): Promise<{ readonly error: Error; readonly tags: ErrorTags } | null> {
  let response: Response;
  try {
    response = await fetchImpl(request.url, request.init);
  } catch {
    // A visitor's own network or blocker is outside our control: not reported.
    return null;
  }

  if (response.ok) return null;

  let details: InsertRefusalTags = {};
  try {
    details = insertRefusalTags(await response.json());
  } catch {
    // Not JSON, or no body: report with no extra tags.
  }
  return {
    error: new Error(`Reaction insert refused: HTTP ${response.status}`),
    tags: { area: 'reaction', kind: 'refused', ...details },
  };
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

/** One visitor's choice, and where to keep it. */
export interface RememberReactionParams {
  /** `null` when storage cannot be reached, in which case nothing is kept. */
  readonly storage: WebStorage | null;
  /** Manifest slug of the game being rated. */
  readonly slug: string;
  /** What to record against it. */
  readonly reaction: StoredReaction;
}

/** Records this visitor's choice for `slug`. Never throws. */
export function rememberReaction({ storage, slug, reaction }: RememberReactionParams): void {
  if (storage === null) return;
  try {
    storage.setItem(storageKey(slug), JSON.stringify(reaction));
  } catch {
    // An unwritable store costs the visitor a duplicate vote next visit.
    // Strictly better than a broken button.
  }
}
