# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git

- Never run `git add`, `git commit`, or `git push`. The repo owner reviews
  and commits every change by hand.
- When a unit of work is done, run a code review subagent, fix what it
  finds, then hand the tree back.
- Confirm before reconfiguring the GitHub remote or Pages, and before
  provisioning real OpenRouter or Sentry credentials.

## Commands

```bash
npm run dev          # Vite dev server, serving the real pipeline output
npm test             # both runners (~15s; smoke tests launch headless Chromium)
npm run test:node    # node --test only  (*.test.ts)
npm run test:web     # vitest only       (*.test.tsx)
npm run test:watch   # vitest in watch mode
npm run typecheck    # both projects: tsconfig.json and tsconfig.web.json
npm run dry-run      # whole generation pipeline against mocks, no API key
npm run build:site   # vite build + assemble-site.ts → deployable dist/
```

First run also needs `npx playwright install chromium`.

- One Node file: `node --experimental-strip-types --test scripts/moderate.test.ts`
- One web file: `npx vitest run src/components/GameMeta.test.tsx`
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
- Avoid `!` and `as`. If a value may be absent, prove it isn't.
  `noUncheckedIndexedAccess` is on, so index access is checked.
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
- Compose conditional classes with a helper, never string concatenation
  that can produce partial class names.
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
- A test guarding an invariant must fail when that invariant is broken.
  Check it by breaking the code on purpose, not by reading the test.
- Tests live beside the code. Two runners, split by what the code needs:
  `*.test.tsx` under **Vitest + jsdom** (rendering, hooks, interaction) and
  `*.test.ts` under **`node --test`** (pure logic and the Node pipeline).
  The patterns are disjoint, so nothing runs twice — keep them that way.
  Node cannot load `.tsx` at all: its type stripping does not transform JSX.
- Query by role or visible text, not by test id or class name.

## Documentation comments

- JSDoc every exported function, type, and interface field. It surfaces on
  hover in editors, which is the point — write for someone reading the
  signature, not the body.
- Document parameters whose meaning isn't obvious from the name: expected
  format, units, what an absent value means. Use `@throws` where a function
  throws, and `{@link}` to connect related helpers.
- Explain *why*, not *what*. Skip comments that restate the code.
- Comment the non-obvious decision, the workaround, and the invariant that
  would otherwise be easy to delete.

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
  the workflow's `on.schedule.cron`, because Actions triggers can't read
  config. The config copy drives the front-end countdown.
- **Published bundles ship byte-for-byte.** Nothing may transform an
  archived `game.html` between the pipeline writing it and the browser
  running it; the dev server has a plugin specifically to prevent Vite
  injecting into them.
- **Nothing downstream branches on mock-vs-real.**
  `scripts/lib/get-client.ts` is the only place that decides, so setting
  `OPENROUTER_API_KEY` flips the pipeline live with no code change.
- **`lib/` stays isomorphic.** It's compiled by both tsconfigs; a Node-only
  API there breaks the browser build. Node-only code belongs in `scripts/`,
  which never ships to Pages.

## Conventions

- Shared helpers live in `scripts/lib/` — config loading, history I/O, path
  building, validation, fixtures. Extend them rather than re-reading or
  re-validating files in a new script.
- Keep I/O at the edges: pure functions for logic, thin wrappers for disk
  and network, so tests need neither.
- Take a `root`/path override on anything that writes, so tests target a
  scratch directory instead of the repo.
- `PLAN.md` tracks epics and stays current as they land; it's part of the
  repo's portfolio story. `SPEC.md` is the original design and is updated
  only when the implementation deliberately diverges.
- Sentry is deliberately stubbed (`sentryDsn: null`,
  `buildErrorReportingSnippet` returns `''`) until credentials exist.
