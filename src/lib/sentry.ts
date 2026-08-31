// Everything about the page shell's own error reporting: the build-time
// DSN, the SDK options, and the call that starts it.
//
// Distinct from scripts/lib/errorReporting.ts, which reports errors thrown
// *inside* a published game's sandboxed frame. That one is a hand-rolled
// snippet because a bundle has to be a self-contained single file with no
// external requests; this one covers the React app around the frame, where
// the real SDK is available. Both post to the same project, and both are
// blocked unless index.html's connect-src lists the ingest origin.
import { browserTracingIntegration, init, type BrowserOptions } from '@sentry/react';

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

/**
 * SDK options for the page shell, separated from {@link startErrorMonitoring}
 * so they can be asserted without starting a real client.
 *
 * @param dsn A DSN already known to be present.
 * @param environment Tags events, so a local run stays filterable apart
 *   from real visitors' errors.
 */
export function sentryOptions(dsn: string, environment: string): BrowserOptions {
  return {
    dsn,
    environment,
    integrations: [browserTracingIntegration()],
    tracesSampleRate: 1,
    // Empty on purpose: propagation adds `sentry-trace` and `baggage`
    // headers to outgoing requests, which would turn every BYOK call into a
    // preflighted cross-origin request against providers that never asked
    // for those headers. There is no backend of our own to correlate with,
    // so nothing is lost.
    tracePropagationTargets: [],
  };
}

/**
 * Starts error and performance monitoring for the page shell.
 *
 * A no-op when no DSN is configured, so a fork with no Sentry credentials
 * runs unchanged — the same rule `buildErrorReportingSnippet` follows for
 * published bundles.
 *
 * @param dsn Defaults to the build-time DSN; tests pass one explicitly.
 * @param environment Defaults to Vite's build mode.
 */
export function startErrorMonitoring(
  dsn: string | null = __SENTRY_DSN__,
  environment: string = __SENTRY_ENVIRONMENT__,
): void {
  if (dsn === null) return;
  init(sentryOptions(dsn, environment));
}
