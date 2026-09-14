// How the daily run tells Sentry what became of it, from Node.
//
// Distinct from the snippet in errorReporting.ts, which reports errors thrown
// *inside* a published game. This one reports the run that produced it — the
// day that exhausted the rotation, and the crash that never got that far.
// Both address the same project through parseSentryDsn/envelopeUrl, so the
// DSN is stated once.
//
// Hand-rolled for the same reason the snippet is, plus one of its own:
// @sentry/node would be a second, disagreeing copy of an envelope format the
// repo already builds, in a dependency that never ships to Pages.
import { randomUUID } from 'node:crypto';
import { errorMessage } from '#lib/errors.ts';
import { loadGenerationConfig } from '#scripts/lib/config/generation.ts';
import { envelopeUrl, parseSentryDsn } from '#scripts/lib/errorReporting.ts';

/**
 * How long a report may take before it is abandoned.
 *
 * The workflow has a 90-minute cap that a failed run must stay inside to
 * record `failed_kept_previous`, so an unresponsive ingest host has to cost
 * seconds, not minutes.
 */
const REPORT_TIMEOUT_MS = 5_000;

/** Cap on one free-text reason, matching the published snippet's own. */
const REASON_MAX_CHARS = 500;

/** Sentry's event id: 32 hex characters, no dashes. */
function eventId(): string {
  return randomUUID().replaceAll('-', '');
}

/** One event's variable parts. Everything else is the same on every report. */
interface EventBody {
  readonly dsn: string | null;
  readonly type: string;
  readonly value: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly extra: Readonly<Record<string, unknown>>;
  readonly release: string | undefined;
  readonly environment: string;
  readonly fetchImpl: typeof fetch;
}

/**
 * POSTs one event, and swallows every way that can go wrong.
 *
 * Nothing here may throw or reject. A run that exhausted the rotation is
 * green by design, and a reporter that threw would turn it red; a run that
 * already crashed must not lose its exit code to a second failure.
 */
async function sendEvent(body: EventBody): Promise<void> {
  const dsn = body.dsn === null ? null : parseSentryDsn(body.dsn);
  if (dsn === null) return;

  try {
    const id = eventId();
    // Sentry's envelope format: envelope header, item header, payload, one
    // per line.
    const envelope = [
      JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify({
        event_id: id,
        timestamp: Date.now() / 1000,
        platform: 'node',
        level: 'error',
        release: body.release,
        environment: body.environment,
        tags: body.tags,
        exception: { values: [{ type: body.type, value: body.value }] },
        extra: body.extra,
      }),
    ].join('\n');

    await body.fetchImpl(envelopeUrl(dsn), {
      method: 'POST',
      body: envelope,
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
  } catch {
    // An error reporter cannot report that it could not report.
  }
}

/** What a day that exhausted the model rotation has to say for itself. */
export interface GenerationFailureReport {
  /** From `config/generation.json`. `null` reports nothing. */
  readonly dsn: string | null;
  /** The day that failed, as `YYYY-MM-DD`. Tagged, never part of the message. */
  readonly date: string;
  readonly attempts: number;
  /** Free text, one per attempt. Each is truncated before it is sent. */
  readonly reasons: readonly string[];
  /** The closed-vocabulary `FailureKind` ids for the same attempts. */
  readonly kinds: readonly string[];
  /** The model each attempt used, parallel to {@link GenerationFailureReport.kinds}. */
  readonly attemptModels: readonly string[];
  readonly quotaExhausted: boolean;
  /** What `restoreManifestFromArchive` did, so a report says what the site is left serving. */
  readonly manifestOutcome: string;
  /** The commit the workflow is running, or `undefined` off CI. */
  readonly release: string | undefined;
  readonly environment: string;
  /** Overridden in tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Reports a day whose every attempt failed.
 *
 * The message is the same on every such day and the date is a tag, so Sentry
 * groups a run of bad days into one issue with a count rather than one issue
 * each — a streak is the signal worth seeing.
 *
 * Never throws: this runs on a path that must still exit green.
 */
export async function reportGenerationFailure(report: GenerationFailureReport): Promise<void> {
  await sendEvent({
    dsn: report.dsn,
    type: 'DailyGenerationFailed',
    value: 'Daily generation exhausted the model rotation',
    tags: {
      date: report.date,
      outcome: 'failed_kept_previous',
      quota_exhausted: String(report.quotaExhausted),
      manifest: report.manifestOutcome,
    },
    extra: {
      attempts: report.attempts,
      kinds: report.kinds,
      attemptModels: report.attemptModels,
      reasons: report.reasons.map((reason) => reason.slice(0, REASON_MAX_CHARS)),
    },
    release: report.release,
    environment: report.environment,
    fetchImpl: report.fetchImpl ?? fetch,
  });
}

/** An exception that escaped the pipeline altogether. */
export interface PipelineCrashReport {
  /** Whatever `catch` bound. Rendered through `errorMessage`. */
  readonly error: unknown;
  /** From `config/generation.json`, via {@link dsnFromConfigOrNull}. */
  readonly dsn: string | null;
  readonly release: string | undefined;
  readonly environment: string;
  /** Overridden in tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Reports the one outcome that is a real CI failure.
 *
 * A run that gives up on generating is expected and reports through
 * {@link reportGenerationFailure}; this covers the run that never reached
 * that decision.
 *
 * Never throws, so the crash keeps its own exit code.
 */
export async function reportPipelineCrash(report: PipelineCrashReport): Promise<void> {
  const { error } = report;
  await sendEvent({
    dsn: report.dsn,
    type: error instanceof Error ? error.name : 'Error',
    value: errorMessage(error),
    tags: { outcome: 'crash' },
    extra: { stack: error instanceof Error ? error.stack : undefined },
    release: report.release,
    environment: report.environment,
    fetchImpl: report.fetchImpl ?? fetch,
  });
}

/**
 * The configured DSN, or `null` if the config cannot be read.
 *
 * Separate from {@link loadGenerationConfig}'s own loud failure because the
 * crash path calls it: an unreadable `config/generation.json` is itself one
 * of the things that crashes a run, and the report must not die reading the
 * file that caused it.
 *
 * @param filePath Defaults to the repo's own `config/generation.json`.
 */
export function dsnFromConfigOrNull(filePath?: string): string | null {
  try {
    return loadGenerationConfig(filePath).sentryDsn;
  } catch {
    return null;
  }
}

/**
 * Which environment a report is tagged with.
 *
 * `generate:local` posts to the same project as the workflow does, so the
 * tag is what keeps a hand-run experiment out of the production picture.
 */
export function pipelineEnvironment(): string {
  return process.env['GITHUB_ACTIONS'] === 'true' ? 'production' : 'local';
}
