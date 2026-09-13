// Reading one game's reactions back out of the store.
//
// Two paths answer the same question. The `reaction_counts` view returns one
// aggregated row and is asked first; the table itself returns every row and
// needs paging. Only a view that has not been provisioned falls back to the
// table, so the counts keep working either side of the DDL being applied.
//
// The schema is generated from this app's own vocabulary by
// scripts/reaction-store-schema.ts — run that to provision it. Its
// constraints, not the checks in the browser, are what actually bound what can
// be stored: anyone who loads the page holds the insert key. Verify RLS is ON
// and that the anon key can neither select nor update; the front-end never
// reads, so a select that returns rows means the policy is wrong. RLS with no
// select policy answers 200 with an empty array rather than an error, so the
// status alone proves nothing. The privileged read key belongs in
// REACTION_STORE_KEY and must never be committed.
import {
  NO_REACTIONS,
  type ReactionTally,
  tallyFromCountsRow,
  tallyReactions,
} from '#scripts/lib/reaction-tally.ts';

/** Everything one read of the store needs. */
export interface ReactionStoreParams {
  /** The game to read — normally yesterday's. */
  slug: string;
  /** Reaction store REST endpoint, or `null` when none is configured. */
  endpointUrl: string | null;
  /**
   * The privileged read key, from an Actions secret — never the public
   * insert key that ships in the page.
   */
  apiKey: string | null;
  /** Replaces global `fetch`; injected by tests. */
  fetchImpl?: typeof fetch;
  /** Read timeout; defaults to {@link REACTION_STORE_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * How long the store gets to answer before the read is abandoned.
 *
 * This runs before generation starts, so a store that accepts the connection
 * and then goes silent would stall a run that has not yet tried to generate
 * anything. The `catch` blocks below cannot bound that on their own: a hung
 * socket never rejects. On the paged path it bounds the whole read rather than
 * each page, so the stall a slow store can cause does not grow with the number
 * of pages.
 */
export const REACTION_STORE_TIMEOUT_MS = 10_000;

// Rows asked for per page. A short page means only that the store's own
// max-rows is lower, never that the rows have run out.
const REACTION_PAGE_SIZE = 1_000;

// Pages of rows one read may fetch before it gives up rather than tally short.
const MAX_REACTION_PAGES = 20;

// The aggregate view the pipeline reads, beside the table the browser writes.
const COUNTS_VIEW = 'reaction_counts';

/** The key headers, when a privileged key is configured. */
function authHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey !== null) {
    headers['apikey'] = apiKey;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Asks the store for every one of a game's rows, or `null` if it could not be
 * asked.
 *
 * The fallback path, used only while {@link COUNTS_VIEW} is not provisioned.
 * Paged, because the store caps how many rows one response may carry —
 * PostgREST's default is 1,000 — and returns that many with no indication
 * that more exist. A single request therefore undercounts a popular game
 * silently, which is indistinguishable from an unpopular one.
 */
async function readTableRows({
  slug,
  endpointUrl,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = REACTION_STORE_TIMEOUT_MS,
}: ReactionStoreParams): Promise<unknown> {
  if (endpointUrl === null) return null;

  // Ordered by primary key: offset paging partitions the rows only if the
  // store sorts them the same way for every page.
  const url = `${endpointUrl}?slug=eq.${encodeURIComponent(slug)}&select=slug,reaction,reasons&order=id`;
  const headers = { ...authHeaders(apiKey), 'Range-Unit': 'items' };

  const rows: unknown[] = [];

  try {
    // Shared across every page, not one timer per request. Built inside the
    // try because it throws on a timeoutMs that is not a whole positive
    // number, and this function answers `null` rather than throwing.
    const signal = AbortSignal.timeout(timeoutMs);

    // One turn more than the page cap. The extra turn reads no data — it is
    // the probe that separates a game sitting exactly on the cap from one
    // past it.
    for (let attempt = 0; attempt <= MAX_REACTION_PAGES; attempt += 1) {
      const from = rows.length;
      const response = await fetchImpl(url, {
        headers: { ...headers, Range: `${from}-${from + REACTION_PAGE_SIZE - 1}` },
        cache: 'no-store',
        signal,
      });

      // An offset past the last row ends the data. On the first page there is
      // nothing to be past, so a 416 there is a refused read, not an empty game.
      if (response.status === 416) return rows.length > 0 ? rows : null;
      if (!response.ok) return null;

      // Annotated rather than left to `Array.isArray`, which narrows an
      // `unknown` to `any[]` and would spread untyped values into `rows`.
      const parsed: unknown = await response.json();
      const rowsOnPage: unknown[] | null = Array.isArray(parsed) ? parsed : null;
      if (rowsOnPage === null) return null;
      if (rowsOnPage.length === 0) return rows;
      if (attempt === MAX_REACTION_PAGES) return null;

      rows.push(...rowsOnPage);
    }
  } catch {
    return null;
  }

  return null;
}

/** Swaps the table's name for the view's, keeping the rest of the path. */
function countsUrl(endpointUrl: string): string | null {
  try {
    const url = new URL(endpointUrl);
    const segments = url.pathname.split('/');

    // A configured endpoint may end in a slash, which leaves a trailing empty
    // segment. The table's name is the last segment that is not empty, and
    // replacing the empty one instead asks the table for a child relation
    // that cannot exist — losing the view on every run, quietly.
    while (segments.length > 0 && segments[segments.length - 1] === '') segments.pop();
    if (segments.length < 2) return null;

    segments[segments.length - 1] = COUNTS_VIEW;
    url.pathname = segments.join('/');
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * What one read of the aggregate view found.
 *
 * `absent` is the state before the view's DDL has been applied, and is the
 * only one that falls back to the table. `empty` is a game nobody reacted to,
 * which is a tally of zero rather than a failure.
 */
type CountsRead =
  | { readonly kind: 'row'; readonly row: unknown }
  | { readonly kind: 'empty' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'absent' };

/** Asks the view for one game's tally in a single request. */
async function readCountsRow(
  { slug, apiKey, fetchImpl = fetch, timeoutMs = REACTION_STORE_TIMEOUT_MS }: ReactionStoreParams,
  base: string,
): Promise<CountsRead> {
  const url = new URL(base);
  url.searchParams.set('slug', `eq.${slug}`);
  url.searchParams.set('select', '*');

  try {
    const response = await fetchImpl(url, {
      headers: authHeaders(apiKey),
      cache: 'no-store',
      // Built inside the try: it throws on a timeoutMs that is not a whole
      // positive number, and this function answers rather than throwing.
      signal: AbortSignal.timeout(timeoutMs),
    });

    // PostgREST answers 404 for a relation it does not know. Revoked access
    // is 401 or 403, so a permissions problem never reads as a missing view.
    if (response.status === 404) return { kind: 'absent' };
    if (!response.ok) return { kind: 'refused' };

    const parsed: unknown = await response.json();
    const rows: unknown[] | null = Array.isArray(parsed) ? parsed : null;
    if (rows === null) return { kind: 'refused' };

    const row = rows[0];
    // The view groups by slug, so a game with no rows has no row at all.
    return row === undefined ? { kind: 'empty' } : { kind: 'row', row };
  } catch {
    return { kind: 'refused' };
  }
}

/**
 * One game's tally, or `null` when the store could not be read.
 *
 * Asks the aggregate view first and transfers one row. Only a view that is
 * not provisioned falls back to reading every row, so an error status never
 * costs a second, far more expensive read.
 */
export async function readTally(params: ReactionStoreParams): Promise<ReactionTally | null> {
  if (params.endpointUrl === null) return null;

  const base = countsUrl(params.endpointUrl);
  const fromView =
    base === null ? ({ kind: 'absent' } as const) : await readCountsRow(params, base);

  switch (fromView.kind) {
    case 'row':
      return tallyFromCountsRow(fromView.row, params.slug);
    case 'empty':
      return NO_REACTIONS;
    case 'refused':
      return null;
    case 'absent': {
      const rows = await readTableRows(params);
      return rows === null ? null : tallyReactions(rows, params.slug);
    }
  }
}
