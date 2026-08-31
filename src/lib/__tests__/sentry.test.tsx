// Under Vitest rather than node --test because the SDK's browser integrations
// touch window during construction.
import { describe, expect, test } from 'vitest';
import { getClient } from '@sentry/react';
import { sentryOptions, startErrorMonitoring } from '../sentry.ts';

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
});

// A fork of this repo has no Sentry credentials, so config/generation.json's
// sentryDsn is null there and the page must still run — the same rule
// buildErrorReportingSnippet follows for published bundles.
test('startErrorMonitoring starts no client when no DSN is configured', () => {
  startErrorMonitoring(null, 'test');

  expect(getClient()).toBeUndefined();
});
