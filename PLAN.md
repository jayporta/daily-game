# Daily AI-Generated Browser Game — Phased Build Plan

This document is the AI-assisted plan this project was built from: an
epics → stories → tasks breakdown produced collaboratively with Claude,
kept up to date as work progresses. See `SPEC.md` for the original design
spec this plan implements.

## Context

`SPEC.md` describes a GitHub Pages site that shows a brand-new AI-generated
browser game every day: a GitHub Actions cron job generates the game at
build time (the only place secrets can safely live), writes it into a dated
archive folder, and rewrites a small `manifest.json` that a static front-end
reads. A sandboxed iframe isolates the untrusted AI-generated code from the
parent page. A "bring your own key" mode lets a visitor generate a personal
one-off game using their own OpenRouter key, entirely client-side. The
pipeline keeps a bounded history log (hot window + AI-summarized rollup) to
avoid repeating past games, and captures runtime errors via Sentry to feed
back into that history.

The project started as a blank slate — only `SPEC.md` existed, no git repo.
It's being built with **relatively minimal code**, in **phases**,
structured as **epics → stories → tasks** so progress stays easy to track
and review incrementally. No OpenRouter key or Sentry account existed at
the start — early work runs entirely on mocks/stubs, with an explicit
checkpoint to swap in real credentials before beta. No GitHub remote
existed either — creating one was a separate checkpoint requiring explicit
confirmation (repo name/visibility) before any `gh repo create` or push.

**Epic 0** and **Epic 1** are built first (pausing at the Epic 0.2
checkpoint for confirmation before touching GitHub). Epics 2–6 are scoped
below so the roadmap is visible, but get a fresh, more detailed planning
pass before each is built.

## Workflow: review before commit, no assistant commits

**Every commit is confirmed by the repo owner.** The assistant never runs
`git add`, `git commit` or `git push` in this project — no exceptions, at
any point in any epic.

When a story or epic reaches a PR-sized, reviewable unit of work, a Haiku
high-effort subagent is spawned to run a code review over the changes.
Once that review comes back clean (or its findings are fixed), work is
handed back to the repo owner, who does the final review and commits
manually. This repeats at each reviewable checkpoint through the whole
build, not just once at the end.

## Architectural note (decided up front to avoid rework later)

The spec lists `lib/extract-bundle-shared.ts` under `scripts/lib/`, but
also says it's "isomorphic, also used by `byok.js`" while `scripts/` is
"never shipped to Pages." Those conflict — `byok.js` runs in the browser
and can only import files Pages actually serves. **Resolution: the
isomorphic extraction core lives at repo-root `/lib/extract-bundle-shared.ts`**
(a small shared directory that ships with the static site), and
`scripts/extract-bundle.ts` imports it via a relative path.

---

## Epic 0: Repo & Project Scaffolding

### Story 0.1 — Local repo skeleton ✅
Done when: `git status` is clean, the full spec directory layout exists
(mostly placeholders), `node --test` runs (0 tests, exit 0), Node version
is pinned.

- Create dirs: `games/archive/.gitkeep`, `config/`, `history/archive/.gitkeep`, `scripts/`, `scripts/lib/`, `scripts/fixtures/mock-responses/`, `lib/`, `.github/workflows/`.
- `package.json`: `"type": "module"`, `"engines": {"node": ">=23.6.0"}`, scripts `test` (`node --experimental-strip-types --test`), `typecheck` (`tsc --noEmit`) and `dry-run`. Test discovery uses `node --test`'s default recursive glob for colocated `*.test.ts` files — passing explicit directory args was found to misbehave, treating them as modules to `require()` rather than search roots.
- `.nvmrc` (`24`).
- Root placeholders: `index.html`, `manifest.json` (null placeholder), `.nojekyll`, `LICENSE`, `README.md`, `CONTRIBUTING.md`, `.gitignore` (node_modules, dist, .env, *.local). The original `app.js`/`styles.css`/`byok.js` placeholders were superseded by the React front-end in `src/`; BYOK becomes a React component there in Epic 5, so no root-level `byok.js` exists.
- TypeScript config split three ways: `tsconfig.base.json` (shared strict options), `tsconfig.json` (Node — `scripts/` + `lib/`), `tsconfig.web.json` (browser — `src/` + `lib/`, JSX). `lib/` is compiled by **both**, which is what keeps it honestly isomorphic: a Node-only API in there fails the web build.
- `PLAN.md` at repo root (this file) — kept in the project since it's part of the portfolio story, showing the AI-assisted planning process. Kept up to date as epics complete.
- `git init` only. No commits are made by the assistant at any point in this project.

### Story 0.2 — GitHub remote connection ✅ (Pages pending first push)
Confirmed with the repo owner, then created: `daily-game`, public, connected
as `origin` (`https://github.com/jayporta/daily-game`).

- [x] Confirm repo name/visibility/org.
- [x] `gh repo create daily-game --public --source=. --remote=origin`.
- [ ] Push `main`, then set GitHub Pages' source to **GitHub Actions** (not
      "deploy from a branch" — the site is assembled at build time by
      `deploy-pages.yml` and never exists in the repo as a servable directory).
      **Blocked on the first commit**, which the repo owner makes by hand —
      the Pages API rejects enablement until the `main` branch exists.
- [ ] Confirm the Pages URL resolves against placeholder content.

### Story 0.3 — Minimal tooling baseline ✅
- Colocated `*.test.ts` convention (e.g. `scripts/build-prompt.test.ts`), run via `node --test` (default recursive discovery).
- One-paragraph "Development" section in `README.md` (`npm test`, later `npm run dry-run`).

---

## Epic 1: Core Generation Pipeline (stubbed AI)

Goal: everything the daily Actions job needs, fully runnable and testable
**locally** with zero real API keys via a swappable mock OpenRouter client.
Sentry is fully deferred — `publish.ts` writes a no-op placeholder where
the real error-reporting snippet later goes.

### Story 1.1 — Config fixtures & schema validators ✅
- `config/models.json` — `{id, active, provider, moderationModel}`-shaped entries; 3 generator models + 1 moderation model; one `active:false` fixture.
- `config/genres.json` — `{id, label, examples[]}`, ~10 fixture genres.
- `config/guardrails.md` — real hand-authored rules (no humans, no violence/gore/sex/drugs/alcohol/profanity, no real-world religion/ethnicity/politics).
- `config/generation.json` — `{historyHotWindowDays: 45, rollupTriggerEntries: 60, remixProbability: 0.2, remixLookbackDays: 90, retryTemperatures: [0.7,0.9,1.0], sentryDsn: null, cronSchedule: "0 13 * * *"}`. `cronSchedule` here must be kept manually in sync with the workflow YAML's `on.schedule.cron`.
- `history/games.json` starts `[]`; `history/summary.json` starts `{genreCounts:{}, genreLastUsed:{}, popularityLeaderboard:[], lessons:""}`.
- `scripts/lib/schema.ts` — small hand-written validators (no JSON-Schema dependency): `validateModelsConfig`, `validateGenresConfig`, `validateGenerationConfig`, `validateHistoryGames`, each returning `{valid, errors[]}`.
- `scripts/lib/schema.test.ts` — valid fixtures pass; hand-broken fixtures (missing field, wrong type, negative number) fail with useful messages.

### Story 1.2 — Isomorphic bundle extraction core ✅
- `lib/extract-bundle-shared.ts` — pure, dependency-free, works in Node and browser:
  `extractBundle(rawText) -> {ok:true, meta:{title,genre,theme,mechanics}, html} | {ok:false, reason}`.
  Parses two fenced blocks (` ```json ` meta, ` ```html ` game).
- `lib/extract-bundle-shared.test.ts` — well-formed response; missing json/html block; malformed JSON; extra prose around blocks; empty html block.
- `scripts/extract-bundle.ts` — thin Node wrapper re-exporting the shared core + a CLI mode for manual debugging.

### Story 1.3 — Mockable OpenRouter client + fixtures ✅
- `scripts/lib/openrouter-client.ts` — `createOpenRouterClient({apiKey, baseUrl, fetchImpl}) -> {complete({model, messages, temperature}) -> Promise<string>}`.
- `scripts/lib/openrouter-client.mock.ts` — `createMockOpenRouterClient({fixtureSequence})` returns canned responses in order.
- `scripts/lib/get-client.ts` — single seam: returns the real client if `OPENROUTER_API_KEY` is set, otherwise the mock. Rest of the pipeline never branches on mock-vs-real.
- `scripts/fixtures/mock-responses/`: `good-maze.txt`, `good-platformer.txt`, `bad-js-error.txt`, `bad-fetch-attempt.txt`, `bad-guardrail-word.txt`, `bad-malformed-blocks.txt`.
- `scripts/lib/openrouter-client.test.ts` — mock sequencing is deterministic; real client's request-shaping is tested with a mocked `fetchImpl`, never hits the network.

### Story 1.4 — Prompt builder & model selection ✅
- `scripts/build-prompt.ts` — `digestHistory`, `selectRemixSuggestion`, `buildPrompt` (guardrails + genres + history digest + remix suggestion + prior-failure feedback).
- `scripts/select-model.ts` — `selectNextModel` (round-robin over `active:true`, skipping disabled).
- Snapshot tests for both against fixed fixtures.

### Story 1.5 — Moderation ✅
- `scripts/moderate.ts` — `keywordScan`, `aiModerationCheck` (mockable via the client seam), `moderate` combining both.
- `scripts/moderate.test.ts` — rejects `bad-guardrail-word.txt`, accepts a clean fixture, and covers a case only the AI check catches. This is the most important test in the whole project per the spec — a bug here silently defeats the safety design.

### Story 1.6 — Smoke test (Playwright) ✅
- `npm install --save-dev playwright`; `npx playwright install chromium`.
- `scripts/smoke-test.ts` — loads html via Playwright, blocks all network except an (empty-for-now) allowlist, collects console/pageerror events, soft-checks canvas was actually drawn to.
- `scripts/smoke-test.test.ts` — rejects `bad-js-error.txt` and `bad-fetch-attempt.txt`; passes the good fixtures.

### Story 1.7 — Generation control loop ✅
- `scripts/call-openrouter.ts` — `generateDailyGame(...)`: up to 3 attempts, each running select-model → build-prompt (with prior failure fed back in) → client.complete → extractBundle → moderate → smokeTest; returns `{status:'success', meta, html, model, attempts}` or `{status:'failed_kept_previous', attempts, reasons}`. CLI entrypoint at the bottom that wires a real/mock client, loads config/history, runs the loop, and calls `publish()` in-process on success.
- `scripts/call-openrouter.test.ts` — mock sequence `[bad-js-error, good-maze]` → 2 attempts, success; all-bad sequence of 3 → `failed_kept_previous` with 3 reasons.

### Story 1.8 — Publish (Sentry stubbed) ✅
- `scripts/lib/history-store.ts` (new, not in spec's file list — added to avoid duplicating read/append/write logic across `publish.ts`, `rollup-history.ts`, and `fetch-feedback.ts`): `readHotWindow`, `readSummary`, `appendEntry`, `writeGamesJson`, `writeGamesMd`.
- `scripts/publish.ts` — `computeExpiresAt` (pure next-occurrence math, no cron-parser dependency), `buildManifest`, `buildErrorReportingSnippet(sentryDsn)` (returns `''` when `sentryDsn` is null — today's case), `publish(...)` writes the archive folder + `meta.json`, rewrites `manifest.json`, appends/writes history files.
- `scripts/publish.test.ts` — run against a scratch temp dir (not the real repo tree); assert shapes; assert the Sentry snippet is empty today.

### Story 1.9 — Local dry-run demo ✅
- `npm run dry-run` in `package.json` (auto-mocked locally since no key is set).
- Run it once; inspect the resulting archive folder, `manifest.json`, `history/games.json`, `history/games.md`.

### Critical files for Epic 1
`scripts/call-openrouter.ts`, `lib/extract-bundle-shared.ts`,
`scripts/lib/get-client.ts`, `scripts/lib/openrouter-client.ts`,
`scripts/publish.ts`, `config/guardrails.md`, `config/genres.json`.

---

## Roadmap for later planning passes (scoped, not detailed yet)

- **Epic 2 — Front-end game viewer** ✅ *(core built; reaction button outstanding)*: React + Tailwind app in `src/`, sandboxed iframe (`allow-scripts` only, `srcDoc` not `src`) for the AI-generated game, cache-busted manifest fetch, metadata strip with live countdown. Verified in the dev server and in a production build served at the real `/daily-game/` subpath. **Outstanding:** the reaction button and its swappable `reaction-config.json` (spec's "loved this" counter, failures silently swallowed).
- **Epic 3 — GitHub Actions wiring** *(deploy half done)*: `deploy-pages.yml` is built — it type-checks, runs `npm run build:site`, and publishes `dist/` via `upload-pages-artifact`/`deploy-pages` on every push to `main`. Still to build: `generate-daily-game.yml` (schedule + `workflow_dispatch` with `dry_run`/`force_model`), config/history validation step, secrets wiring (runs mocked until Epic 6's checkpoint), bot commit/push, PR-time secret-prefix grep check.
- **Epic 4 — History compaction & rollup**: `scripts/rollup-history.ts`, hot-window aging into `history/archive/YYYY-MM.jsonl`, workflow step wiring, rollup fixture test.
- **Epic 5 — BYOK mode**: `prompt-fragments.json` generation in `publish.ts`, a React panel component (key held only in a closure/local component state, cleared immediately, never persisted to any storage), reuse of `lib/extract-bundle-shared.ts`, leakage test.
- **Epic 6 — Sentry & real credentials cutover [CHECKPOINT]**: repo owner provisions a Sentry account/DSN and an OpenRouter key; wire both as repo secrets; replace the stub error-reporting snippet with the real one; allowlist Sentry's ingest domain in the smoke test; `fetch-feedback.ts`; real local dry-run, then `workflow_dispatch dry_run:true` runs, then one real run reviewed by hand before trusting the schedule; forced-failure and error-tracking verification passes.

## Technology choices

**TypeScript throughout.** All Node-side pipeline code in `scripts/` and
`lib/` is TypeScript, run directly via Node's native type stripping — no
`ts-node`, no `tsx`, no build step for the pipeline. `typescript` is a
devDependency used only for real type-checking (`npm run typecheck`),
never for runtime transpilation. This requires Node 23.6+, where type
stripping is on by default.

**React for the front-end UI** (Epics 2 and 5), to lean on JSX's automatic
escaping for the AI-generated *text* fields shown in the page chrome
(title, genre, model id) rather than hand-rolling DOM/`innerHTML`
sanitization. This does not change the core security design: the
AI-generated game HTML/JS still renders inside a sandboxed
`<iframe sandbox="allow-scripts">` with no `allow-same-origin`, exactly as
the spec requires. React never touches that code path — it only helps with
the surrounding metadata UI. Because browsers can't run TypeScript or JSX
directly, the handful of files actually shipped to Pages (the React UI,
and `lib/extract-bundle-shared.ts` once BYOK needs it in-browser) do need
a small compile step; its detail is deferred to Epic 2's planning pass.

## Verification (for Epics 0–1)

- `npm test` green after each story in Epic 1 (Node's built-in test runner, per spec Verification §1).
- Story 1.5's moderation tests explicitly reject all hand-crafted bad fixtures (spec Verification §2).
- Story 1.6's smoke tests explicitly reject the JS-error and network-attempt fixtures (spec Verification §2).
- Story 1.9's dry-run produces a complete, well-formed archive/manifest/history tree (spec Verification §3, mock-only version — the real-key version is deferred to Epic 6).
- `git log` / `git status` clean after Epic 0; Pages URL resolves after the Story 0.2 checkpoint is confirmed and executed.

## Checkpoints requiring explicit confirmation

**Every commit.** This is the standing rule, not a per-epic exception: the
assistant never runs `git add`, `git commit` or `git push`. Work stops at
each PR-sized unit, a code review runs, findings are fixed, and the tree is
handed to the repo owner — who reviews it and commits by hand. Nothing
enters git history without the repo owner putting it there. See "Workflow:
review before commit, no assistant commits" above for the full cycle.

Two further points additionally need confirmation **before the work
happens**, not just before it lands:

1. **Epic 0, Story 0.2** — creating/connecting the real GitHub remote and enabling Pages. Confirm repo name/visibility before running `gh repo create` or pushing.
2. **Epic 6** — provisioning real OpenRouter + Sentry credentials before any beta/scheduled-cron testing. Everything through Epic 5 runs on mocks/stubs by design.
