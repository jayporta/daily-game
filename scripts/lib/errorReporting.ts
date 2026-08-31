// Everything about reporting a published game's runtime errors: reading the
// DSN, and building the fixed snippet publish.ts appends to every bundle.
//
// The snippet is written HERE, not by the model, so a bad generation can
// never omit or subvert it. It is appended *after* the smoke test, on
// purpose: the snippet only fires on an uncaught error, so attaching it
// before would fill Sentry with events from the broken games we reject and
// never publish.
//
// Hand-rolled rather than loading Sentry's browser SDK from a CDN: the
// prompt requires a self-contained single HTML file with no external
// requests, and the smoke test enforces it. This adds one request, only
// when a game actually breaks.

/** The parts of a Sentry DSN needed to address its ingest endpoint. */
export interface SentryDsn {
  /** Includes the trailing colon, as `URL.protocol` gives it. */
  readonly protocol: string;
  /** Host and any port, e.g. `o123.ingest.us.sentry.io`. */
  readonly host: string;
  /** Ingest-only public key. Safe to ship in a page; it cannot read events. */
  readonly publicKey: string;
  readonly projectId: string;
}

/**
 * Reads a DSN of the form `https://<publicKey>@<host>/<projectId>`.
 *
 * @returns `null` for anything that is not a usable DSN, so a typo disables
 *   reporting rather than emitting a snippet that posts into the void.
 */
export function parseSentryDsn(dsn: string): SentryDsn | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }

  const projectId = url.pathname.replace(/^\/+/, '');
  if (url.username.length === 0) return null;
  // Sentry project ids are numeric; anything else means a mangled DSN.
  if (!/^\d+$/.test(projectId)) return null;

  return { protocol: url.protocol, host: url.host, publicKey: url.username, projectId };
}

/**
 * Where events are POSTed, derived from the DSN.
 *
 * The DSN itself is not an endpoint — a request to it 404s. Sentry ingests
 * at `/api/<projectId>/envelope/`, authenticated by query string.
 */
function envelopeUrl(dsn: SentryDsn): string {
  return `${dsn.protocol}//${dsn.host}/api/${dsn.projectId}/envelope/?sentry_key=${dsn.publicKey}&sentry_version=7`;
}

/**
 * Fixed, trusted snippet appended to every published game.
 *
 * @param sentryDsn From `config/generation.json`. Returns `''` when it is
 *   null (the current state, with no Sentry account) or unparseable, so the
 *   published bundle is byte-identical to what the model wrote.
 * @param slug Tags the event, so an error can be traced to the day's game.
 */
export function buildErrorReportingSnippet(sentryDsn: string | null, slug: string): string {
  const dsn = sentryDsn === null ? null : parseSentryDsn(sentryDsn);
  if (dsn === null) return '';

  return `
<!-- Error reporting appended by publish.ts — not model-authored. -->
<script>
(function () {
  var ENDPOINT = ${JSON.stringify(envelopeUrl(dsn))};
  var SLUG = ${JSON.stringify(slug)};

  function eventId() {
    var id = '';
    for (var i = 0; i < 32; i += 1) id += Math.floor(Math.random() * 16).toString(16);
    return id;
  }

  function report(value, extra) {
    try {
      var id = eventId();
      // Sentry's envelope format: envelope header, item header, payload,
      // one per line.
      var body =
        JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }) + '\\n' +
        JSON.stringify({ type: 'event' }) + '\\n' +
        JSON.stringify({
          event_id: id,
          timestamp: Date.now() / 1000,
          platform: 'javascript',
          level: 'error',
          tags: { slug: SLUG },
          exception: { values: [{ type: 'Error', value: String(value).slice(0, 500) }] },
          extra: extra
        });
      // No Content-Type: it keeps the request CORS-simple, so a dying page
      // is not waiting on a preflight. keepalive lets it outlive the frame.
      fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, mode: 'cors' });
    } catch (e) {}
  }

  window.addEventListener('error', function (event) {
    report(event.message, { source: String(event.filename), line: event.lineno });
  });
  window.addEventListener('unhandledrejection', function (event) {
    report(event.reason, { kind: 'unhandledrejection' });
  });
})();
</script>
`;
}
