# Procedural Site: Daily AI-Generated Browser Game

## Context

The user wants a free website (hosted on GitHub Pages, so zero hosting cost) where the
"content" is a complete browser game, invented from scratch by AI and rebuilt from
nothing once a day. Every visitor during that day plays the same game; when the daily
cron job fires, that game is gone forever and replaced by something completely
different — genre, theme, mechanics, everything. The project doubles as an open,
visible experiment in what free-tier open-weight models (via OpenRouter) can actually
build when given nothing but a prompt and asked to produce a working game.

Because GitHub Pages only serves static files (no server, no way to hide secrets),
all AI generation for the shared daily game must happen at build time inside a
GitHub Actions job, which is the only place a secret (the OpenRouter API key) can
safely live. The project also offers a bring-your-own-key mode where a visitor can
generate a personal one-off game using their own API key, called directly from their
browser — their key must never touch any server (there isn't one) or persist anywhere.

Hard content constraints (non-negotiable, drive the guardrails design): no blood,
gore, murder, sex, drugs, alcohol, cigarettes, or foul language, and — deliberately —
**no human characters at all**, which sidesteps any risk of touching race or real-world
religion. All games must be self-contained, code-drawn 2D (Canvas/CSS/SVG, optional
Web Audio), since the AI can only emit code/text, not binary assets.

The AI pipeline keeps its own log of past games (genre, theme, mechanics, model used,
popularity) so it can avoid repeating itself and can optionally build a "spiritual
successor" to a popular past game — but never an identical repeat. Since that log is
read on every single generation run, it can't simply grow forever: it's kept as a
recent-detail window plus a periodically AI-summarized rollup of anything older, so
token cost and pipeline latency stay flat over time rather than growing every day.
Bugs that surface only after publish (which a build-time smoke test can't catch) are
also tracked, via real client-side error capture, so recurring failure patterns can
feed back into the same distilled "lessons" the pipeline reads before generating.

## Recommended Approach

### Repository layout

```
/index.html                                                   # Vite entry point (mounts the React app)
/src/                                                         # React + Tailwind front-end (TypeScript)
    main.tsx, App.tsx, index.css
    components/GameFrame.tsx, components/GameMeta.tsx
    lib/manifest-client.ts, lib/countdown.ts
/lib/                                                         # isomorphic: runs in Node AND the browser
    extract-bundle-shared.ts, types.ts
/manifest.json                                                # single pointer the front-end reads each load
/games/archive/YYYY-MM-DD-<slug>/game.html                    # each day's published bundle, kept forever (archive/browsable history)
/config/
    models.json          # rotation list of OpenRouter free-tier model IDs (user-editable)
    genres.json           # editable genre catalog with examples (user-editable)
    guardrails.md          # human-authored content rules, injected verbatim into every prompt (user-editable)
    generation.json         # small tunables: retry temperatures, remix probability/threshold/lookback
/history/
    games.json            # hot window: full-detail entries for the last N days (published or failed_kept_previous)
    games.md               # human-readable mirror of the hot window, regenerated each run, never parsed
    summary.json            # rolled-up cold storage: per-genre counts, all-time popularity leaderboard, curated "lessons" text
    archive/YYYY-MM.jsonl    # raw entries once they age out of the hot window (cold, rarely read, permanent record)
/scripts/                  # Node, run only inside GitHub Actions, never shipped to Pages
    select-model.ts, build-prompt.ts, call-openrouter.ts, extract-bundle.ts,
    moderate.ts, smoke-test.ts, fetch-feedback.ts, rollup-history.ts, publish.ts,
    assemble-site.ts
    lib/openrouter-client.ts, lib/openrouter-client.mock.ts, lib/get-client.ts,
    lib/schema.ts, lib/config-store.ts, lib/history-store.ts, lib/paths.ts,
    lib/types.ts, lib/fixtures.ts
    fixtures/mock-responses/*.txt
/.github/workflows/generate-daily-game.yml   # daily generation
/.github/workflows/deploy-pages.yml          # build + deploy the site
/dist/                     # Vite build output (gitignored; assembled into the Pages artifact)
.nojekyll   LICENSE   README.md   CONTRIBUTING.md   PLAN.md
package.json   .nvmrc   tsconfig*.json   vite.config.ts
```

The isomorphic extraction core lives at repo-root `/lib/`, not under `/scripts/lib/`:
`scripts/` is never shipped to Pages, but this module is also imported by the
browser-side BYOK code, so it has to sit somewhere the site build can reach.

`.nojekyll` is required so Pages serves `games/archive/*` and other non-Jekyll files
untouched. `manifest.json` (at the site root) is the single pointer the front-end reads
each load — never a symlink, since Pages doesn't reliably resolve those; the daily job
simply writes a new dated archive folder and rewrites this one small file atomically at
the end of a successful run.

### The daily pipeline (GitHub Actions, `generate-daily-game.yml`)

Triggers: `schedule` (daily cron, UTC) and `workflow_dispatch` (with a `dry_run` flag
and a `force_model` override, for manual testing before ever trusting the schedule).

Steps, in order:
1. Checkout, setup Node, `npm ci`, install Playwright's headless Chromium only.
2. Validate `config/*.json` and `history/games.json` against JSON schemas — protects
   against a hand-edit (e.g. the user tweaking `genres.json`) breaking the pipeline.
3. Pick the next model from `config/models.json` (round-robin over `active: true`
   entries, skipping any the user has disabled).
4. Read yesterday's reaction count and any Sentry-captured runtime errors for
   yesterday's slug, and patch both into yesterday's `history/games.json` entry
   (done early so it's captured even if the rest of the run later fails).
5. Build the prompt (`build-prompt.ts`, pure function, no network) from: guardrails
   (verbatim) + genre list (marking recently-used genres to avoid) + a digest of the
   last ~10 history entries ("do not repeat this theme/mechanic combo") + an optional
   "you may build a spiritual successor to `<popular past game>`, but it must differ
   in genre, theme, and at least one mechanic" suggestion, computed from whichever
   past original has the highest popularity score and hasn't been remixed too often.
6. Generate + validate, in a single retry loop (up to 3 attempts):
   - Call OpenRouter with the selected model.
   - Extract the response into `meta` (title/genre/theme/mechanics JSON) and
     `html-game` (one self-contained HTML file, inline `<style>`/`<script>`, no
     external requests, no image/audio files) via a strict two-fenced-block format
     the model is instructed to always return.
   - Moderate: a fast keyword/heuristic scan against the guardrail list, plus a
     second AI call (different model than the generator) asked to strictly answer
     PASS/FAIL against the same guardrails text.
   - Smoke-test: load the extracted bundle in headless Chromium via Playwright,
     block all outbound network requests (asserting the no-network constraint was
     honored), watch for JS errors/exceptions over a short settle window, and
     softly check that something was actually drawn to canvas.
   - On any failure: feed the specific failure reason back into the next attempt's
     prompt ("you produced a JS error: X — be more defensive this time") so retries
     have a real chance of self-correcting, not just re-rolling.
   - If all 3 attempts fail: log a `failed_kept_previous` history entry and leave
     `manifest.json` and the live site completely untouched — this is a normal,
     successful pipeline outcome (exit green), not a CI failure.
7. On success: write `games/archive/YYYY-MM-DD-<slug>/{game.html,meta.json}` (with a
   small fixed error-reporting snippet appended to `game.html` by `publish.ts`
   itself — not part of the model's output — that reports uncaught errors to
   Sentry), rewrite `manifest.json` (see schema below), append the history entry,
   regenerate `history/games.md`, commit as a bot identity, and push.
8. History rollup (conditional, e.g. runs once a month or whenever `history/games.json`
   exceeds the configured hot-window size): feed the entries about to age out, plus
   the current `history/summary.json`, to an AI call that returns an updated summary
   — merged/deduped genre counts, an updated all-time popularity leaderboard, and a
   rewritten "lessons" section distilling recurring problems and what's worked well,
   kept to a few paragraphs rather than growing indefinitely. The raw aging entries
   are moved into `history/archive/YYYY-MM.jsonl` (append-only, cold, rarely read)
   rather than deleted, so nothing is ever permanently lost — full detail is always
   recoverable from either the archive files or git history — but the pipeline's
   day-to-day reads stay bounded to the hot window plus one small summary file.

Secrets: `OPENROUTER_API_KEY` (generation + moderation calls) and a separate
`SENTRY_AUTH_TOKEN` (read-only API token, used only by `fetch-feedback.ts` to query
yesterday's captured errors) — both repo secrets, never logged in full and never
written into any committed file. A CI check on pull requests greps changed files
under the published directories for known key prefixes as cheap defense-in-depth.

### Manifest schema (drives the "generated at / model / expires" display)

```json
{
  "date": "2026-08-29",
  "slug": "2026-08-29-glass-beetle-maze",
  "path": "games/archive/2026-08-29-glass-beetle-maze/game.html",
  "title": "Beetle of a Thousand Mirrors",
  "genre": "maze-adventure",
  "model": "qwen/qwen-2.5-72b-instruct:free",
  "generatedAt": "2026-08-29T13:04:00Z",
  "expiresAt": "2026-08-30T13:00:00Z"
}
```
`generatedAt` is set by `publish.ts` at commit time; `expiresAt` is computed from the
workflow's own cron schedule (next scheduled run time), not hardcoded, so changing
the cron cadence later doesn't require a separate code change. The front-end
(`app.js`) renders these plainly near the game — e.g. "Generated Aug 29, 2026 · built
by `qwen/qwen-2.5-72b-instruct:free` · replaced in 6h 12m" — with the countdown
computed client-side from `expiresAt` and updated on a `setInterval`.

### History compaction & error tracking

`history/games.json` only ever holds a hot window of full-detail entries (size
configurable in `config/generation.json`, e.g. 45-60 days) — this is what
`build-prompt.ts` reads for recent-history digest and remix-candidate selection, so
prompt cost stays flat regardless of project age. `history/summary.json` holds
everything older, already reduced to:
```json
{
  "genreCounts": { "maze-adventure": 12, "platformer": 9, "...": 0 },
  "genreLastUsed": { "maze-adventure": "2026-08-28", "...": "..." },
  "popularityLeaderboard": [
    { "slug": "2026-06-02-tide-clock-garden", "theme": "...", "mechanicsSummary": "...", "popularityScore": 41 }
  ],
  "lessons": "Freeform text, a few paragraphs, rewritten each rollup: recurring pitfalls (e.g. \"canvas resize handlers frequently forget to rescale existing entity positions, causing them to drift off-screen after a window resize\"), patterns that reliably worked well, and genres/mechanics combos worth revisiting."
}
```
`build-prompt.ts` includes `summary.json`'s `lessons` text and leaderboard verbatim
in every prompt (small, bounded size by construction) alongside the hot-window
digest — so the model always sees "recent specifics + distilled long-term wisdom"
rather than either the full raw history or nothing.

Post-publish runtime errors are captured via Sentry's free client-side SDK: a public
DSN (a write-only ingest key, safe to expose the same as any analytics snippet) is
embedded in the small error-reporting snippet `publish.ts` appends to each
`game.html` before committing — this snippet is fixed and trusted, never something
the model writes, so it can't be omitted or subverted by a bad generation. Because
the sandbox attribute restricts capabilities (same-origin access, top navigation,
popups) but does not block network requests, this reporting call works fine from
inside the sandboxed iframe. The smoke test's network-blocking check (§ generation
pipeline) allowlists exactly Sentry's ingest domain so this one intentional
exception doesn't trip the "fully self-contained, no network calls" validation that
still applies to everything else in the bundle. `fetch-feedback.ts` queries
Sentry's API (using `SENTRY_AUTH_TOKEN`) for yesterday's slug each morning, and any
captured errors get folded into that day's history entry and, eventually, into the
rollup's "lessons" text. BYOK personal games are out of scope for this — they're
one-off and not part of the shared history/lessons corpus.

### Front-end (React + Tailwind, built with Vite)

The front-end is a small React app written in TypeScript, styled with Tailwind, and
built by Vite. React is used deliberately for safety as well as ergonomics: every
field displayed in the page chrome (title, genre, theme, model id) is AI-generated
text, and JSX escapes it automatically, so there is no hand-rolled `innerHTML`
sanitisation to get wrong. React does **not** touch the game itself — that is the
iframe's job, below.

- Fetch `manifest.json` (cache-busted with a timestamp query param), then fetch the
  bundle's HTML text and assign it to an `<iframe sandbox="allow-scripts" srcdoc="...">`
  — no `allow-same-origin`, `allow-top-navigation`, or `allow-popups`, so the
  AI-authored code is fully isolated from the parent page and has no access to any
  key or storage. This is the site's real trust boundary and is independent of the
  UI framework: React only renders the surrounding chrome.
- Because the AI-authored bundle must ship byte-for-byte as the pipeline wrote it and
  the smoke test approved it, the Vite dev server is configured to serve
  `games/**/*.html` raw. Vite's HTML pipeline would otherwise inject its HMR client
  into those files, so what you previewed locally would not be what ships.
- A reaction button ("loved this") posts to a small free, no-login, CORS-friendly hit
  counter (e.g. counterapi.dev or abacus.jasoncameron.dev — configured via a small
  swappable `reaction-config.json`, not hardcoded, since these are single-maintainer
  hobby services that could change terms). Failures are silently swallowed — a dead
  counter must never break the page or the game.

### Deployment (`deploy-pages.yml`)

Introducing a build step means Pages can no longer simply serve the repo root. The
site is assembled from two sources that live in different places:

- the **built app** — `dist/`, produced by `vite build` and gitignored
- the **published content** — `manifest.json` and `games/archive/**`, committed to the
  repo by the daily job, plus `.nojekyll`

`scripts/assemble-site.ts` copies the second group into `dist/`, producing a complete
site directory. Keeping assembly in a tested script rather than inline workflow YAML
means it can be run and verified locally (`npm run build:site`) exactly as CI runs it.

`deploy-pages.yml` runs that build and publishes `dist/` via
`actions/upload-pages-artifact` + `actions/deploy-pages`. It triggers on pushes to
`main`, so both a human commit and the daily job's commit republish the site. Pages is
therefore configured with **GitHub Actions** as its source, not "deploy from a branch".

Nothing about this changes the runtime URLs: `manifest.json` and
`games/archive/<slug>/game.html` sit at the same paths in the deployed site that they
occupy in the repo, which is also how the dev server serves them.

### Bring-your-own-key mode (BYOK panel, a React component in `src/`)

A collapsed "Generate your own game" panel with a password-style key input and a
visible, static (non-fetched) explanation that the key is used only for one request,
held only in that click handler's closure, never written to any storage, and
discarded immediately after use — inviting visitors to verify this themselves via
DevTools. On generate: the key is read directly from the input inside the click
handler (never assigned to any module/global/DOM state), the input is cleared
immediately, and a browser-side `fetch` goes straight to the provider's API. The
response is parsed with the same extraction logic used server-side (factored into a
small shared module) and rendered into its own separate sandboxed iframe. A small
public (non-secret) `prompt-fragments.json`, regenerated by the daily pipeline,
mirrors the current guardrails/genre text so BYOK prompts stay in sync without
duplicating the hand-maintained source files. BYOK output is explicitly not
moderated or smoke-tested before rendering — the sandboxed iframe (same mechanism
already required for the daily game) is the accepted mitigation, and this tradeoff
is documented plainly in the README.

### Config files the user hand-edits

- `config/genres.json` — id/label/examples per genre; the prompt hands the model the
  full list minus recently-used genres and lets the model choose, rather than
  assigning one, since picking its own genre/theme pairing gives better results.
- `config/guardrails.md` — the exact rules (no humans, no violence/gore, no
  sex/drugs/alcohol/profanity, no real-world religion/ethnicity/politics), fed
  verbatim into both the generation and moderation prompts so they can never drift
  out of sync with each other.
- `config/models.json` — rotation list of OpenRouter free-tier model IDs with an
  `active` flag per entry (the user must periodically check OpenRouter's free-model
  list by hand and update this, since it can't be discovered reliably at generation
  time) and the moderation model to use.
- `config/generation.json` — also holds `historyHotWindowDays` and the rollup
  trigger threshold, so the user can tune how much detail stays "hot" without
  touching code.

## Verification

1. **Unit-level, no network**: test `build-prompt.ts`'s assembly against fixed fake
   history/config (snapshot the output), test `extract-bundle.ts`'s parser against
   hand-crafted good/malformed fenced-block strings, and test the JSON schema
   validators against valid/invalid config fixtures — using Node's built-in test
   runner, no extra dependency.
2. **Safety-check validation**: hand-craft a few known-bad bundles (one that throws a
   JS error, one that attempts a `fetch()`, one with an obvious guardrail-violating
   word) and confirm `smoke-test.ts`/`moderate.ts` actually reject them — this is
   the most important test, since a bug here would silently defeat the whole
   safety design.
3. **Local dry-run**: run the generation script locally against a real personal
   OpenRouter key (kept only in a local shell env var, never committed) to validate
   the full prompt → generate → extract → moderate → smoke-test chain before ever
   touching GitHub Actions.
4. **Actions dry-run**: trigger `workflow_dispatch` with `dry_run: true` several
   times, confirming a valid bundle is produced and checks pass/fail as expected
   without touching `main`; then one real `dry_run: false` run, reviewing the exact
   `git diff` by hand (new archive folder, updated manifest, appended history, no
   secret text anywhere) before trusting the schedule.
5. **Forced-failure test**: manually force a broken/rate-limited model via
   `force_model`, confirming the retry loop runs all 3 attempts, logs
   `failed_kept_previous`, leaves the live site untouched, and still exits green
   (not a false-alarm CI failure).
6. **Deployed-site manual QA**: load the live Pages URL and confirm the game renders
   in a sandboxed iframe with no loosened permissions; open DevTools Network tab and
   confirm the only calls are to the Pages domain plus the one reaction-counter
   call (no OpenRouter call ever originates from a visitor's browser for the daily
   game); confirm the generated/model/expiry text displays and the countdown ticks
   down correctly.
7. **BYOK leakage test**: paste a real (rotatable) key into the BYOK panel, confirm
   in DevTools Application tab that neither `localStorage` nor `sessionStorage`
   ever contains it, confirm in the Network tab that exactly one outbound request
   goes straight to the provider's domain, confirm the input is empty and no trace
   remains after the page reloads, and confirm the BYOK iframe carries the same
   sandbox restrictions as the daily game's.
8. **Error-tracking test**: deliberately publish a bundle containing a forced
   `throw`, confirm it appears in Sentry tagged with that day's slug, confirm
   `fetch-feedback.ts` retrieves it the next morning, and confirm the smoke test's
   network-blocking check still fails a bundle that attempts a request to any
   domain other than Sentry's ingest endpoint.
9. **Rollup test**: manually run `rollup-history.ts` against a fixture
   `history/games.json` with entries older than the configured hot window and a
   fixture `summary.json`, confirming it produces an updated leaderboard, updated
   genre counts, and a coherent rewritten "lessons" section, and that the aged
   entries land in `history/archive/YYYY-MM.jsonl` rather than being lost.

## Critical Files

- `.github/workflows/generate-daily-game.yml` — orchestrates the whole daily
  pipeline and is the only place the OpenRouter secret is exposed.
- `scripts/call-openrouter.ts` — the retry/moderation/smoke-test control loop;
  correctness here is the crux of both the safety and quality guarantees.
- `scripts/extract-bundle.ts` (and its shared/isomorphic core) — the parsing
  contract between free-form model output and everything downstream, including
  BYOK reuse.
- `config/guardrails.md` and `config/genres.json` — the hand-tunable source of
  truth; must stay easy for the user to edit without touching code.
- `src/components/GameFrame.tsx` and the BYOK panel — the entire client-side trust
  boundary (iframe sandboxing, key non-persistence, manifest-driven metadata display).
- `scripts/rollup-history.ts` and `history/summary.json` — keeps prompt cost and
  pipeline latency flat as the project ages, by turning aging entries into a
  bounded, distilled summary instead of letting `history/games.json` grow forever.
