# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git

- Never run `git add`, `git commit`, or `git push`. The repo owner reviews
  and commits every change by hand.
- When a unit of work is done, work the checklist below, then run a code
  review subagent, fix what it finds, and hand the tree back. The review is
  a backstop — anything on that checklist it has to catch was a wasted
  round trip.
- Confirm before reconfiguring the GitHub remote or Pages, and before
  provisioning real OpenRouter or Sentry credentials.

## Before handing work back

Every item here has been violated at least once and cost a review cycle.

- `npm run typecheck` and `npm test` both clean. State the counts.
- For each new test that guards an invariant: break the code on purpose,
  confirm the test fails, restore. Say what you broke and what failed.
- No new `as`, `!`, or `any` — `as const` and `import { x as y }` aside. If
  one is genuinely unavoidable, a comment beside it says why.
- Nothing added duplicates something already here. Before writing a type,
  guard, constant, fixture or class string, grep for it.
- Anything user-visible: look at it. `npm run build:site`, or drive the
  page with Playwright, before claiming it renders.
- Every flag, option and branch introduced has a caller. A `--flag` no
  script passes is dead code behind a misleading doc entry.
- Deleting a test requires saying what still covers it, or why nothing
  needs to — a test that asserted nothing had no coverage to replace.

## Commands

```bash
npm run dev          # Vite dev server, serving the real pipeline output
npm test             # both runners (~15s; smoke tests launch headless Chromium)
npm run test:node    # node --test only  (*.test.ts)
npm run test:web     # vitest only       (*.test.tsx)
npm run test:watch   # vitest in watch mode
npm run typecheck    # both projects: tsconfig.json and tsconfig.web.json
npm run validate     # every hand-editable config + history file
npm run rollup       # compact history/games.json into archive + summary
npm run reflect      # rewrite summary.json's lessons from the hot window
npm run schema       # print the reaction store's DDL
npm run dry-run      # whole pipeline against mocks, writing nothing to disk
npm run generate:local  # same, but publishes locally so `npm run dev` has a game
npm run build:site   # vite build + assemble-site.ts → deployable dist/
```

First run also needs `npx playwright install chromium`.

- One Node file: `node --experimental-strip-types --test scripts/__tests__/moderate.test.ts`
- One web file: `npx vitest run src/components/__tests__/GameFacts.test.tsx`
- By name under `node --test`, **always scope it to a file**: append
  `--test-name-pattern "fails closed"`. Repo-wide it hangs — the smoke-test
  file's `before()` launches a browser that its `after()` never closes when
  no test in that file matches. Vitest's `-t` has no such problem.
- Run `npm run typecheck` after editing types; `tsc` is only a checker here,
  so nothing else catches type errors.

## TypeScript

- Imports carry explicit `.ts`/`.tsx` extensions — Node strips types at
  runtime and there is no bundler for pipeline code.
- Never `any`. Use `unknown` at boundaries and narrow with a type guard.
- Model states as discriminated unions rather than several optional fields.
  Prefer exhaustive `switch`/ternaries over defensive `if (x?.y)` chains.
- Annotate exported signatures; let inference handle locals.
- Union types or `as const` objects instead of `enum`.
- Avoid `!` and `as`. If a value may be absent, prove it isn't — `?? fallback`
  or an early return, not an assertion. `noUncheckedIndexedAccess` is on, so
  index access is checked, and `noUnusedLocals`/`noUnusedParameters` catch
  what a deletion leaves behind.
- `catch` binds `unknown`, and a `throw` can carry anything. Never
  `(error as Error).message` — it renders the literal string `"undefined"`
  for a bare throw. Use `errorMessage()` from `lib/errors.ts`.
- Data arriving from disk, the network or `localStorage` is validated and
  then used, never `JSON.parse(x) as T`. Config and history go through
  `loadValidatedJson` from `scripts/lib/validation.ts`, paired with the
  validator that lives beside the file it describes; anything else gets a
  guard that narrows field by field. Every reader of a given file validates,
  or the one that doesn't becomes the crash.
- `satisfies` to validate an object against a type without widening it.
- Prefer `readonly` for parameters and fields that are never reassigned.

## React

- Function components only. Type props with an exported interface; never
  `React.FC`.
- Import hooks and types by name (`import { useState, type ReactNode }`).
  Don't reach for a global `React.` namespace.
- `useEffect` is only for synchronizing with something outside React.
  Anything derivable during render should be computed during render, not
  mirrored into state.
- Every effect that starts something must stop it — clear intervals, abort
  requests, and guard against setting state after unmount.
- Keep state at the lowest component that needs it. Lift only when shared.
- Hold in state what the component renders, not the raw value it is derived
  from, when the derived value changes less often. React bails out on an
  unchanged value: that is what keeps a one-second interval from
  re-rendering a label that reads the same for a minute.
- Stable, meaningful `key`s in lists. Never an array index.
- Never `dangerouslySetInnerHTML`. AI-generated text renders as JSX so React
  escapes it; AI-generated *markup* goes in the sandboxed iframe, nowhere
  else.
- Extract non-visual logic into plain functions or hooks so it can be tested
  without rendering.
- One component per file.
- One hook per file. Don't create a hook or Context in the same file as a component.

## Tailwind

- Configuration is CSS-first (`@import 'tailwindcss'` in `src/index.css`).
  There is no `tailwind.config.js`.
- Utilities in markup. Reach for `@apply` only when a pattern genuinely
  repeats and cannot be a component.
- Use scale values (`p-4`, `text-slate-400`). Arbitrary values like
  `[13px]` or `[#1a1a1a]` mean the scale should have grown instead.
- A class string that appears twice is already a duplicate — extract a
  component (`PillButton`, `CodeChip`). Don't wait for a third copy.
- Variants belong in a `Record<Variant, string>` of complete class strings.
  Never assemble one from fragments: Tailwind only generates what it can
  read whole in the source.
- Don't repeat a background a parent already paints. A child with none
  shows the ancestor's.
- Mobile-first: unprefixed base, then `sm:`/`md:` to widen.
- No inline `style` for anything a utility covers.

## Testing

- Test observable behavior, not internals. A test should fail only when
  something a caller cares about actually broke.
- Prefer real collaborators; inject a seam (`fetchImpl`, a clock, a client)
  rather than reaching for broad mocks.
- Each test asserts one thing, with a name stating the expected behavior.
- Cover the edges that matter: empty, malformed, expired, unreachable.
- Never assert something that cannot fail, and avoid snapshots for logic.
  Two ways this has slipped through: an assertion that cannot *observe*
  what its name claims (`Node.contains` never crosses into an iframe's
  document, so it cannot see what is inside the sandbox — assert on the
  `srcdoc` string), and an assertion that is only true at compile time
  (`node --test` strips types rather than checking them, so only
  `npm run typecheck` ever sees it).
- A new test must be able to fail while the tests beside it pass. If a
  stronger assertion nearby already covers it, it is documentation — put it
  in a comment, not a second run. This matters most where a test is
  expensive: the smoke tests each launch a browser.
- Fixtures come from `scripts/lib/testFixtures.ts` or
  `src/lib/testFixtures.ts`. Never paste a manifest, config or history entry
  into a second test file.
- A test guarding an invariant must fail when that invariant is broken.
  Check it by breaking the code on purpose, not by reading the test.
- Tests live in a `__tests__/` directory beside the code they cover, so a
  source directory lists only source. Test-only helpers and mock data keep
  their `test`-prefixed camelCase name (`testFixtures.ts`) and stay *out* of
  `__tests__/`, beside the code instead — they are imported by tests in
  several directories.

  Keep the `.test.ts`/`.test.tsx` suffix on every test file. `test:node` is
  a bare `node --test` with no glob, so discovery is Node's default: it
  matches the suffix at any depth, but would silently skip a file renamed to
  `testFoo.ts` — a green run with the tests quietly gone. The `test` prefix
  must never be hyphenated (`test-foo.ts`) for the mirror-image reason: Node
  claims that pattern and would run a helper as a suite.
- Two runners, split by what the code needs:
  `*.test.tsx` under **Vitest + jsdom** (rendering, hooks, interaction) and
  `*.test.ts` under **`node --test`** (pure logic and the Node pipeline).
  The patterns are disjoint, so nothing runs twice — keep them that way.
  Node cannot load `.tsx` at all: its type stripping does not transform JSX.
- Query by role or visible text, not by test id or class name.

## Comments

Two kinds, with different jobs. Don't write the first kind's prose in the
second kind's place.

**Doc comments** — `/** */` on exported functions, types, interface fields
and props. These surface on hover, which is the point, so they earn their
length.

- JSDoc every export. Write for someone reading the signature, not the body.
- Document parameters whose meaning isn't obvious from the name: expected
  format, units, what an absent value means. Use `@throws` where a function
  throws, and `{@link}` to connect related helpers.
- Describe the contract as it stands. Never narrate how it used to work.

**Every other comment** — a brief description of what the block does. One
line, two at most.

- No rationale essays, and no arguing the code against an alternative that
  isn't in the tree. "A rather than B, because B would…" only confuses a
  reader who never saw B, and B is usually something that existed only in a
  chat log. State what the code does.
- Skip comments that restate the code.
- Do note the genuine trap: a workaround, a constraint the code cannot
  express, a deliberate duplication that would otherwise be merged away, an
  invariant easy to delete by accident. State it plainly; don't justify it.
- A doc comment moves with the function it documents. A stranded one
  silently describes its new neighbour.

## Invariants

Breaking any of these is a correctness or safety regression, not a
refactor.

- **The iframe sandbox.** `sandbox="allow-scripts"` with `srcDoc`, in
  `src/components/GameFrame.tsx`. Never add `allow-same-origin`,
  `allow-top-navigation`, or `allow-popups` — with allow-scripts they let
  the frame escape. This, not React, is the trust boundary.
- **Moderation and the smoke test fail closed.** An unreachable moderator,
  an ambiguous verdict, an unparseable response, or a page that won't load
  all count as rejections. A false rejection costs a retry; a false
  acceptance publishes banned content to a public site.
- **Three failed attempts is a successful run.** It records
  `failed_kept_previous`, leaves `manifest.json` and the live site
  untouched, and exits green. Only an unexpected crash is a CI failure.
- **The prompt contract and the extractor must agree.**
  `OUTPUT_FORMAT_CONTRACT` in `scripts/build-prompt.ts` describes the two
  fenced blocks that `lib/extract-bundle-shared.ts` parses. Change them
  together or every generation fails.
- **`cronSchedule` is duplicated by hand** in `config/generation.json` and
  `generate-daily-game.yml`'s `on.schedule.cron`, because Actions triggers
  can't read config. Both copies exist now; change them together. The config
  copy drives the front-end countdown via `computeExpiresAt`, so a drift
  shows up as a countdown that expires at the wrong time rather than as a
  failure.
- **The daily job's push cannot trigger the deploy.** A push authenticated
  with `GITHUB_TOKEN` does not start other workflows, so
  `generate-daily-game.yml` calls `deploy-pages.yml` through `workflow_call`
  instead of relying on its `push` trigger. Removing that `deploy` job, or
  the `workflow_call:` trigger it depends on, leaves the site serving
  yesterday's game with every workflow green.
- **Published bundles ship byte-for-byte.** Nothing may transform an
  archived `game.html` between the pipeline writing it and the browser
  running it; the dev server has a plugin specifically to prevent Vite
  injecting into them.
- **Nothing downstream branches on mock-vs-real.**
  `scripts/lib/get-client.ts` is the only place that decides, so setting
  `OPENROUTER_API_KEY` flips the pipeline live with no code change.
- **`connect-src` must list the Sentry ingest origin.** A `srcdoc` iframe
  inherits the parent's CSP, so the snippet `publish.ts` appends runs under
  `index.html`'s policy. Drop
  `https://o4512003238199296.ingest.us.sentry.io` from `connect-src` and the
  browser blocks every report from both the page and the game frame, with
  nothing anywhere saying so — an error reporter cannot report that it could
  not report. `npm run validate` cross-checks the two files; change the DSN
  and the origin together.
- **The page's CSP must never restrict scripts or styles.** `index.html`
  carries a deliberately partial policy with no `default-src`, `script-src`
  or `style-src`. A `srcdoc` iframe inherits the parent's CSP, so any of
  those would block the inline `<script>` in every generated bundle —
  breaking the whole site in production while every test still passes.
  The frame's `sandbox` attribute is what contains that code, not the CSP.
  `index.html`'s own inline theme bootstrap relies on this too, so a
  `script-src` added with a hash for that script would still break the
  games.
- **Reaction feedback is a closed vocabulary, never freetext.**
  `DISLIKE_REASONS` in `lib/reaction-types.ts` is the only thing that
  crosses the network, and `fetch-feedback.ts` tallies by iterating that
  vocabulary rather than the store's response. Anyone who loads the page
  holds the insert key, so no string from the store may ever reach
  `history/games.json` or the generation prompt.
- **Only our own words reach the generation prompt as guidance.**
  `correctiveDirectives` in `scripts/build-prompt.ts` keys fixed wording off
  the closed `DISLIKE_REASONS` and `FAILURE_KINDS` vocabularies, so nothing a
  visitor or a previous generation authored is quoted into the next prompt.
  `digestHistory` shows model-authored `theme`/`mechanics`/`title` as labelled
  historical data, never as instructions, and never shows `failureReasons`.

  The `lessons` note is the one indirect path, and it is worth understanding
  before changing: `failureReasons` (which embed console output from
  AI-written games) reach the *reflection* prompt in
  `scripts/lib/lessons-prompt.ts`, the model there writes the note, and the
  note reaches the *generation* prompt. Two model hops, capped at 300
  characters per reason and 4,000 for the note. That is a deliberate trade —
  a note distilled from "smoke-js-error x3" alone would be useless — but it
  is the one place model-authored text can influence later instructions, so
  keep both caps and never route `failureReasons` into the generation prompt
  directly.
- **`reflect-lessons.ts` owns `lessons`; `rollup-history.ts` owns the archive
  and the tallies.** The rollup makes no model call and carries the note
  through untouched. Two writers of one field would race each other.
- **The archive is append-only and nothing is ever dropped.**
  `scripts/rollup-history.ts` moves entries out of `history/games.json` into
  `history/archive/YYYY-MM.jsonl`. Every entry must survive in one place or
  the other — the rollup archives before it truncates, and re-archiving a
  date it already holds is a no-op so a re-run cannot duplicate. Losing an
  entry loses a day of the project permanently.
  The summary's tallies are *derived* from the whole archive by
  `summariseEntries`, never added to the previous summary. That is what makes
  a repeated or interrupted rollup safe: accumulating instead double-counted
  every genre when a run repeated before `games.json` was truncated.
- **`lib/` stays isomorphic.** It's compiled by both tsconfigs; a Node-only
  API there breaks the browser build. Node-only code belongs in `scripts/`,
  which never ships to Pages.

## Conventions

- One definition per fact, in the narrowest home that reaches every caller:
  `lib/` when both sides need it, `src/lib/` for browser-only, `scripts/lib/`
  for Node-only. A type declared twice drifts — these already had to be
  merged back: `ReactionConfig`, the `localStorage` seam, and the shape
  check for `config/reaction-config.json`.
- Shared helpers live in `scripts/lib/` (history I/O, path building,
  validation primitives) and `src/lib/` on the browser side. Extend them
  rather than re-reading or re-validating files in a new script.
- **Group by subject, not by kind of fact** — the Common Closure Principle,
  and the organising rule for this whole repo, not just for config. A
  subject's type, its rules, its behaviour and its I/O live in one module,
  so answering "what is this and who reads it?" means opening one file.
  `scripts/lib/config/models.ts` is the reference shape: it holds
  `config/models.json`'s type, validator and loader together.

  Never reintroduce a module that collects one *kind* of thing across many
  subjects — a `schema.ts` of every validator, a `types.ts` of every type, a
  `utils.ts`, a `constants.ts`. That shape was removed deliberately. It
  reads as cohesive but isn't: nothing in it changes for the same reason, so
  one conceptual change edits four files, and a function ends up so far from
  its only caller that it looks like dead or test-only code. That is not
  hypothetical — it happened here, and nearly got production validators
  renamed as test helpers.

  Three deliberate exceptions, each because something outside the subject
  needs it: an isomorphic type and guard stay in `lib/` (`ReactionConfig`,
  `ByokModelsConfig`) because both build targets compile it; paths stay
  centralised in `scripts/lib/paths.ts` so `createPaths(root)` can redirect
  the whole pipeline at a scratch directory; and `scripts/lib/validation.ts`
  holds only primitives with many unrelated consumers. Anything else that
  wants to be shared needs that many consumers first — two callers in one
  area is local, not shared.
- An npm script's name has to describe what it does. `dry-run` once wrote to
  disk, and the front-end told visitors to run it.
- Keep I/O at the edges: pure functions for logic, thin wrappers for disk
  and network, so tests need neither.
- Take a `root`/path override on anything that writes, so tests target a
  scratch directory instead of the repo.
- Planning artifacts stay out of the repo. A design spec and an
  epics/stories plan file once lived here and were deliberately removed;
  the commit history is the record of how the work was split into
  reviewable chunks. Don't reintroduce them, and don't add
  cross-references to them from code.
- Sentry is live. `config/generation.json`'s `sentryDsn` is the one copy of
  the DSN: `publish.ts` reads it for the snippet it appends to bundles, and
  `vite.config.ts` inlines it into the browser build as `__SENTRY_DSN__`.
  Never paste the DSN into `src/` — `secret-scan.yml` treats a literal there
  as a leaked credential. A fork with `sentryDsn: null` still runs: both
  `buildErrorReportingSnippet` and `startErrorMonitoring` no-op.
