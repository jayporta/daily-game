import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  dsnFromConfigOrNull,
  type GenerationFailureReport,
  pipelineEnvironment,
  reportGenerationFailure,
  reportPipelineCrash,
} from '#actions_pipeline/lib/pipelineReporting.ts';
import { GENERATION_CONFIG } from '#actions_pipeline/lib/testFixtures.ts';
import { isRecord } from '#lib/guards.ts';

const DSN = 'https://abc123@o1.ingest.us.sentry.io/42';
const ENVELOPE_URL =
  'https://o1.ingest.us.sentry.io/api/42/envelope/?sentry_key=abc123&sentry_version=7';

/**
 * The first exception on a captured event, narrowed field by field.
 *
 * The envelope is re-parsed from JSON, so its shape has to be proved rather
 * than asserted with `as`.
 */
function firstException(captured: Captured | undefined): { type: string; value: string } {
  const exception = captured?.event['exception'];
  assert.ok(isRecord(exception), 'event carries no exception');
  const values = exception['values'];
  assert.ok(Array.isArray(values), 'exception carries no values');
  const first: unknown = values[0];
  assert.ok(isRecord(first), 'exception carries no first value');
  const { type, value } = first;
  assert.ok(
    typeof type === 'string' && typeof value === 'string',
    'exception is not a string pair',
  );
  return { type, value };
}

/** Writes one generation config to a scratch file and returns its path. */
function scratchConfig(t: { after(fn: () => void): void }, config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-reporting-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'generation.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return file;
}

/** One captured request, with the envelope's three lines already parsed. */
interface Captured {
  readonly url: string;
  readonly contentType: string | null;
  readonly header: Record<string, unknown>;
  readonly itemHeader: Record<string, unknown>;
  readonly event: Record<string, unknown>;
}

/** A fetch that records what it was asked to send and answers 200. */
function capturing(into: Captured[]): typeof fetch {
  return async (input, init) => {
    const lines = String(init?.body).split('\n');
    into.push({
      url: String(input),
      contentType: new Headers(init?.headers).get('content-type'),
      header: JSON.parse(lines[0] ?? '{}'),
      itemHeader: JSON.parse(lines[1] ?? '{}'),
      event: JSON.parse(lines[2] ?? '{}'),
    });
    return new Response('', { status: 200 });
  };
}

function failureReport(overrides: Partial<GenerationFailureReport> = {}): GenerationFailureReport {
  return {
    dsn: DSN,
    date: '2026-09-13',
    attempts: 7,
    reasons: ['smoke test found a JS error: ReferenceError: draw is not defined'],
    kinds: ['smoke-js-error'],
    attemptModels: ['a/model:free'],
    quotaExhausted: false,
    manifestOutcome: 'intact',
    release: 'abc1234',
    environment: 'production',
    ...overrides,
  };
}

test('reportGenerationFailure sends nothing when no DSN is configured', async () => {
  const sent: Captured[] = [];

  await reportGenerationFailure({ ...failureReport({ dsn: null }), fetchImpl: capturing(sent) });

  assert.deepEqual(sent, []);
});

test('reportGenerationFailure sends nothing when the DSN is unparseable', async () => {
  const sent: Captured[] = [];

  await reportGenerationFailure({
    ...failureReport({ dsn: 'https://sentry.io/not-a-dsn' }),
    fetchImpl: capturing(sent),
  });

  assert.deepEqual(sent, []);
});

test('reportGenerationFailure posts one envelope to the ingest URL the DSN names', async () => {
  const sent: Captured[] = [];

  await reportGenerationFailure({ ...failureReport(), fetchImpl: capturing(sent) });

  assert.equal(sent.length, 1);
  const [captured] = sent;
  assert.equal(captured?.url, ENVELOPE_URL);
  assert.equal(captured?.itemHeader['type'], 'event');
  assert.equal(typeof captured?.header['event_id'], 'string');
  assert.equal(captured?.event['event_id'], captured?.header['event_id']);
});

test('reportGenerationFailure carries the run outcome as tags and its detail as extra', async () => {
  const sent: Captured[] = [];

  await reportGenerationFailure({ ...failureReport(), fetchImpl: capturing(sent) });

  const event = sent[0]?.event ?? {};
  assert.equal(event['level'], 'error');
  assert.equal(event['release'], 'abc1234');
  assert.equal(event['environment'], 'production');
  assert.deepEqual(event['tags'], {
    date: '2026-09-13',
    outcome: 'failed_kept_previous',
    quota_exhausted: 'false',
    manifest: 'intact',
  });
  const extra = event['extra'];
  assert.ok(isRecord(extra), 'event carries no extra');
  assert.deepEqual(extra['kinds'], ['smoke-js-error']);
  assert.deepEqual(extra['attemptModels'], ['a/model:free']);
  assert.equal(extra['attempts'], 7);
});

// Every failed day must land in one Sentry issue rather than one issue per
// day, so the date belongs in a tag and never in the grouped message.
test('reportGenerationFailure groups every failed day under one message', async () => {
  const sent: Captured[] = [];

  await reportGenerationFailure({ ...failureReport(), fetchImpl: capturing(sent) });
  await reportGenerationFailure({
    ...failureReport({ date: '2026-09-14', attempts: 5 }),
    fetchImpl: capturing(sent),
  });

  const [first, second] = [firstException(sent[0]), firstException(sent[1])];
  assert.equal(first.value, second.value);
  assert.ok(!first.value.includes('2026-09-13'));
});

// A reporter that threw would turn a `failed_kept_previous` run — a green
// run by design — into a red one.
test('reportGenerationFailure resolves when the ingest request fails', async () => {
  await reportGenerationFailure({
    ...failureReport(),
    fetchImpl: () => Promise.reject(new Error('network down')),
  });
});

test('reportPipelineCrash names the error that killed the run', async () => {
  const sent: Captured[] = [];

  await reportPipelineCrash({
    error: new TypeError('cannot read properties of undefined'),
    dsn: DSN,
    release: 'abc1234',
    environment: 'production',
    fetchImpl: capturing(sent),
  });

  const thrown = firstException(sent[0]);
  assert.equal(thrown.type, 'TypeError');
  assert.equal(thrown.value, 'cannot read properties of undefined');
  assert.deepEqual(sent[0]?.event['tags'], { outcome: 'crash' });
});

// A bare `throw 'text'` carries no name or message; errorMessage() is what
// keeps it from rendering as the literal string "undefined".
test('reportPipelineCrash describes a thrown non-Error', async () => {
  const sent: Captured[] = [];

  await reportPipelineCrash({
    error: 'everything broke',
    dsn: DSN,
    release: undefined,
    environment: 'local',
    fetchImpl: capturing(sent),
  });

  assert.equal(firstException(sent[0]).value, 'everything broke');
});

test('reportPipelineCrash resolves when the ingest request fails', async () => {
  await reportPipelineCrash({
    error: new Error('boom'),
    dsn: DSN,
    release: undefined,
    environment: 'local',
    fetchImpl: () => Promise.reject(new Error('network down')),
  });
});

test('dsnFromConfigOrNull returns null when the config cannot be read', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-reporting-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(dsnFromConfigOrNull(join(dir, 'generation.json')), null);
});

// A hand-run `generate:local` posts to the same project as the workflow, so
// the two have to be separable once they are there.
test('pipelineEnvironment separates a CI run from a local one', () => {
  const original = process.env['GITHUB_ACTIONS'];
  try {
    process.env['GITHUB_ACTIONS'] = 'true';
    assert.equal(pipelineEnvironment(), 'production');
    delete process.env['GITHUB_ACTIONS'];
    assert.equal(pipelineEnvironment(), 'local');
  } finally {
    if (original === undefined) delete process.env['GITHUB_ACTIONS'];
    else process.env['GITHUB_ACTIONS'] = original;
  }
});

// The crash this reports is often the config loader itself throwing, and a
// generation config can be unloadable while its DSN is perfectly readable.
test('dsnFromConfigOrNull reads the DSN out of a config that fails validation', (t) => {
  const file = scratchConfig(t, {
    ...GENERATION_CONFIG,
    sentryDsn: DSN,
    cronSchedule: '',
  });

  assert.equal(dsnFromConfigOrNull(file), DSN);
});

test('dsnFromConfigOrNull returns null when the file is not JSON', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-reporting-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'generation.json');
  writeFileSync(file, '{ not json', 'utf8');

  assert.equal(dsnFromConfigOrNull(file), null);
});

test('dsnFromConfigOrNull returns null when the config declares no DSN', (t) => {
  const file = scratchConfig(t, { ...GENERATION_CONFIG, sentryDsn: null });

  assert.equal(dsnFromConfigOrNull(file), null);
});

// Sentry's ingest is told what an envelope is. The published snippet omits
// this header to keep its request CORS-simple on a dying page; Node has no
// such constraint, and a rejected report would vanish into the swallow.
test('reportGenerationFailure declares the envelope content type', async () => {
  const sent: Captured[] = [];

  await reportGenerationFailure({ ...failureReport(), fetchImpl: capturing(sent) });

  assert.equal(sent[0]?.contentType, 'application/x-sentry-envelope');
});
