// Everything about the page shell's own error reporting: the build-time DSN,
// the SDK options, and the deferred start.
//
// Distinct from scripts/lib/errorReporting.ts, which reports errors thrown
// *inside* a published game's sandboxed frame. That one is a hand-rolled
// snippet because a bundle has to be a self-contained single file with no
// external requests; this one covers the React app around the frame, where
// the real SDK is available. Both post to the same project, and both are
// blocked unless index.html's connect-src lists the ingest origin.
//
// The SDK is loaded with a dynamic import, so it lands in its own chunk
// instead of the critical path — it is several times the size of the app it
// watches. Everything below the buffer exists so that deferring it does not
// cost the errors thrown before it arrives.
import type { BrowserOptions } from '@sentry/react';

/**
 * `config/generation.json`'s `sentryDsn`, inlined by `vite.config.ts`.
 *
 * Reached through a build-time define rather than written here because
 * `.github/workflows/secret-scan.yml` treats a DSN literal anywhere under
 * `src/` as a leaked credential, and because `publish.ts` already reads the
 * same field — a second copy in the source would drift from it.
 */
declare const __SENTRY_DSN__: string | null;

/** Vite's build mode, inlined by `vite.config.ts`; tags every event. */
declare const __SENTRY_ENVIRONMENT__: string;

/** The component stack React 19 hands its root error callbacks. */
export interface ReactErrorInfo {
  readonly componentStack?: string | null | undefined;
}

/**
 * Cap on errors held while the SDK loads.
 *
 * A page that is throwing in a loop must not grow an unbounded array, and a
 * dynamic import that never resolves — an offline visitor, a blocked CDN —
 * would otherwise keep every one of them alive for the session.
 */
const MAX_BUFFERED = 20;

/** Short, low-cardinality labels attached to an event, for filtering. */
export type ErrorTags = Readonly<Record<string, string>>;

interface PendingError {
  readonly error: unknown;
  readonly info: ReactErrorInfo | undefined;
  readonly tags: ErrorTags | undefined;
}

type Deliver = (error: unknown, info: ReactErrorInfo | undefined, tags: ErrorTags | undefined) => void;

let deliver: Deliver | null = null;
const buffered: PendingError[] = [];

function report(error: unknown, info?: ReactErrorInfo, tags?: ErrorTags): void {
  if (deliver !== null) {
    deliver(error, info, tags);
    return;
  }
  if (buffered.length < MAX_BUFFERED) buffered.push({ error, info, tags });
}

/**
 * Reports an error the app caught and handled itself, rather than one that
 * reached a global handler.
 *
 * For failures that are recovered from — a request that failed and was turned
 * into a message on screen — which no `error` event ever sees. Buffered like
 * any other until the SDK loads, and a no-op for the whole session when no DSN
 * is configured.
 *
 * Callers decide what is worth reporting: an expected failure of someone
 * else's API key is not a defect, and reporting every one would bury the
 * events that are.
 *
 * @param tags Low-cardinality labels to filter by. Never put a secret, a URL
 *   carrying one, or anything a visitor typed in here.
 */
export function reportError(error: unknown, tags?: ErrorTags): void {
  report(error, undefined, tags);
}

/**
 * SDK options for the page shell, separated from {@link startErrorMonitoring}
 * so they can be asserted without starting a real client.
 *
 * No tracing integration and no `tracesSampleRate`: a page that renders a
 * header and one iframe has no transaction worth sampling, and the tracing
 * bundle was the majority of the JavaScript this site shipped.
 *
 * @param dsn A DSN already known to be present.
 * @param environment Tags events, so a local run stays filterable apart
 *   from real visitors' errors.
 */
export function sentryOptions(dsn: string, environment: string): BrowserOptions {
  return {
    dsn,
    environment,
    // Empty on purpose: propagation adds `sentry-trace` and `baggage`
    // headers to outgoing requests, which would turn every BYOK call into a
    // preflighted cross-origin request against providers that never asked
    // for those headers. There is no backend of our own to correlate with,
    // so nothing is lost.
    tracePropagationTargets: [],
  };
}

/**
 * The callback React 19's root takes for render-phase errors.
 *
 * Stable and synchronous, so it can be handed to `createRoot` before the SDK
 * exists — React catches render errors itself and surfaces them only here, so
 * without this a component crash reaches the console and nowhere else.
 */
export function reactErrorReporter(): (error: unknown, info: ReactErrorInfo) => void {
  return (error, info) => report(error, info);
}

/**
 * Starts error monitoring for the page shell, loading the SDK off the
 * critical path.
 *
 * Errors thrown before it arrives are buffered and replayed, so deferring
 * costs coverage of nothing — including a throw during the very first render.
 *
 * A no-op when no DSN is configured, so a fork with no Sentry credentials
 * runs unchanged — the same rule `buildErrorReportingSnippet` follows for
 * published bundles.
 *
 * @param dsn Defaults to the build-time DSN; tests pass one explicitly.
 * @param environment Defaults to Vite's build mode.
 * @returns Resolves once the SDK is live and the backlog has been sent.
 */
export async function startErrorMonitoring(
  dsn: string | null = __SENTRY_DSN__,
  environment: string = __SENTRY_ENVIRONMENT__,
): Promise<void> {
  if (dsn === null) return;

  // Ours only until the SDK installs its own; see the removal below.
  const onError = (event: ErrorEvent): void => report(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent): void => report(event.reason);
  globalThis.addEventListener('error', onError);
  globalThis.addEventListener('unhandledrejection', onRejection);

  // Destructured, not `const Sentry = await import(...)`. Rollup can only
  // tree-shake a dynamic import whose bindings it can see: taking the
  // namespace object instead pulls in the whole SDK and triples this chunk
  // (28.9 kB gzip against 155.9 kB, measured).
  const { captureException, init, reactErrorHandler } = await import('@sentry/react');
  init(sentryOptions(dsn, environment));

  // Dropped now that the SDK's own global handlers are installed, so a later
  // error is not reported twice.
  globalThis.removeEventListener('error', onError);
  globalThis.removeEventListener('unhandledrejection', onRejection);

  const handleReactError = reactErrorHandler();
  deliver = (error, info, tags) => {
    if (info === undefined) captureException(error, tags === undefined ? undefined : { tags });
    else handleReactError(error, info);
  };
  for (const pending of buffered.splice(0)) deliver(pending.error, pending.info, pending.tags);
}
