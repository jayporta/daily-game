// Under Vitest rather than node --test because the SDK's browser integrations
// touch window during construction.
import { describe, expect, test, vi } from 'vitest';
import { getClient } from '@sentry/react';
import { reactErrorReporter, sentryOptions, startErrorMonitoring } from '../sentry.ts';

/**
 * What the SDK was actually handed. The real `init` still runs — only the two
 * delivery calls are intercepted, so `getClient()` below still sees a client.
 */
const { reported } = vi.hoisted(() => ({ reported: [] as unknown[] }));

vi.mock('@sentry/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/react')>();
  return {
    ...actual,
    captureException: (error: unknown) => {
      reported.push(error);
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
