// Under Vitest rather than node --test because the SDK's browser integrations
// touch window during construction.

import { getClient } from '@sentry/react';
import { describe, expect, test, vi } from 'vitest';
import {
  reactErrorReporter,
  reportError,
  sentryOptions,
  startErrorMonitoring,
} from '@/lib/sentry.ts';

/**
 * What the SDK was actually handed. The real `init` still runs — only the two
 * delivery calls are intercepted, so `getClient()` below still sees a client.
 */
const { reported, scopes, sdkUnavailable } = vi.hoisted(() => ({
  reported: [] as unknown[],
  scopes: [] as unknown[],
  /** Stands in for a chunk request that never arrives. */
  sdkUnavailable: { value: false },
}));

vi.mock('@sentry/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/react')>();
  return {
    ...actual,
    init: (options: Parameters<typeof actual.init>[0]) => {
      if (sdkUnavailable.value) throw new Error('chunk request failed');
      return actual.init(options);
    },
    captureException: (error: unknown, scope?: unknown) => {
      reported.push(error);
      scopes.push(scope);
      return '';
    },
    reactErrorHandler: () => (error: unknown) => {
      reported.push(error);
    },
  };
});

const DSN = 'https://examplekey@o1.ingest.us.sentry.io/2';

describe('sentryOptions', () => {
  test('tags events with the environment it is given', () => {
    expect(sentryOptions(DSN, 'production').environment).toBe('production');
  });

  // The trap: any non-empty value here attaches `sentry-trace` and `baggage`
  // to outgoing requests, which turns every BYOK call into a preflighted
  // cross-origin request and breaks generation against providers that reject
  // the unexpected headers.
  test('propagates trace headers to nothing', () => {
    expect(sentryOptions(DSN, 'production').tracePropagationTargets).toEqual([]);
  });

  // Tracing was the majority of this site's JavaScript and sampled every
  // pageview, for a page that renders a header and one iframe.
  test('starts no tracing', () => {
    const options = sentryOptions(DSN, 'production');

    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.integrations).toBeUndefined();
  });

  // A BYOK failure logs the provider's verbatim error body, and a provider
  // rejecting a key echoes part of that key back. The SDK captures console
  // output as breadcrumbs by default, which would carry that text out of the
  // browser attached to some later event.
  test('drops console breadcrumbs', () => {
    const beforeBreadcrumb = sentryOptions(DSN, 'production').beforeBreadcrumb;

    expect(beforeBreadcrumb?.({ category: 'console', message: 'sk-live-abc' }, {})).toBeNull();
  });

  test('keeps breadcrumbs that are not console output', () => {
    const beforeBreadcrumb = sentryOptions(DSN, 'production').beforeBreadcrumb;
    const navigation = { category: 'navigation' };

    expect(beforeBreadcrumb?.(navigation, {})).toBe(navigation);
  });
});

// A fork of this repo has no Sentry credentials, so config/generation.json's
// sentryDsn is null there and the page must still run — the same rule
// buildErrorReportingSnippet follows for published bundles.
test('startErrorMonitoring starts no client when no DSN is configured', async () => {
  await startErrorMonitoring(null, 'test');

  expect(getClient()).toBeUndefined();
});

// The SDK is loaded off the critical path, so there is a window in which the
// page can throw with nothing listening. Deferring must not cost those: the
// buffer is the whole reason the dynamic import is safe.
test('an error thrown before the SDK arrives is replayed into it', async () => {
  const beforeLoad = new Error('thrown during the first render');
  reactErrorReporter()(beforeLoad, { componentStack: '\n    at App' });

  expect(reported).toEqual([]);

  await startErrorMonitoring(DSN, 'test');

  expect(reported).toEqual([beforeLoad]);
});

// A handled failure never reaches a global error handler, so without an
// explicit entry point it is reported nowhere at all.
test('reportError delivers a handled error with its tags', async () => {
  await startErrorMonitoring(DSN, 'test');
  reported.length = 0;
  scopes.length = 0;

  const handled = new Error('gemini returned no output');
  reportError(handled, { area: 'byok', provider: 'gemini' });

  expect(reported).toEqual([handled]);
  expect(scopes).toEqual([{ tags: { area: 'byok', provider: 'gemini' } }]);
});

// main.tsx fires this as `void startErrorMonitoring()`, so a rejection here
// is an unhandled rejection and nothing else — in the one function whose job
// is to make sure those are seen.
test('startErrorMonitoring resolves when the SDK cannot be loaded', async () => {
  sdkUnavailable.value = true;
  try {
    await expect(startErrorMonitoring(DSN, 'test')).resolves.toBeUndefined();
  } finally {
    sdkUnavailable.value = false;
  }
});
