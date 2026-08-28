# Vercel production build fix

## Status

**Local: PASS.** Every deterministic gate is green, and the failure has been
reproduced and then fixed inside a faithful copy of the exact file set Vercel
receives.

**Vercel deployment: NOT YET VERIFIED.** This change has not been pushed, so no
redeploy has run. The deployment is not claimed as fixed until Vercel has
actually built the commit.

This was a build-configuration fix only. No application behaviour, provider,
search, playback, personalization or Phase 6 code was touched, and no environment
variable name changed.

---

## Exact root cause

`package.json` built with:

```
"build": "tsc -b --pretty false && vite build"
```

`tsc -b` with no argument resolves `tsconfig.json`, which references
`tsconfig.app.json` and `tsconfig.node.json`. `tsconfig.app.json` had:

```jsonc
"include": ["src"]
```

`src` contains the application **and** the entire browser-side test suite. So the
production build compiled **69 test files** — verified rather than assumed:

```
$ tsc -p tsconfig.app.json --listFiles | grep -cE '\.test\.|/test/'
69
```

Those files import their fixtures and harness through the `@/` alias:

```ts
import { renderApp } from '@/test/render'
import { server } from '@/test/msw/server'
import { YOUTUBE_PAYLOADS } from '@/test/fixtures/youtube'
```

`.vercelignore` removes `src/test` from the upload. The importers therefore
arrive on Vercel; the modules they import do not.

---

## Why the local build worked

Nothing was missing locally. `src/test/` is on disk, so `@/test/render` resolves,
all 69 test files compile, and `tsc -b` exits 0. The configuration was equally
wrong locally — it simply had every file it was asking for.

The build only fails where the file set differs from the working tree, which is
exactly and only on Vercel.

## Why Vercel failed

`.vercelignore` is applied when the deployment source is uploaded, so the build
container receives a *subset* of the repository. The compiler was configured
against the full tree while the container held the pruned one.

### Reproduced, not inferred

A copy of the exact upload set was assembled — every path removed that
`.vercelignore` removes — and the old build run against it:

```
$ node ../node_modules/typescript/bin/tsc -b --force --pretty false
exit=2
TS2307 ("Cannot find module") : 66
total errors                   : 68
```

```
src/components/layout/AppShell.test.tsx(3,27): error TS2307: Cannot find module '@/test/render' …
src/components/search/SearchBar.test.tsx(4,29): error TS2307: Cannot find module '@/test/msw/handlers' …
src/components/search/SearchBar.test.tsx(5,39): error TS2307: Cannot find module '@/test/fixtures/audius' …
```

The two non-TS2307 errors were downstream of the same cause: with `@/test/render`
unresolvable, its `trackRows` helper typed as `any`, so two `.map((row) => …)`
callbacks became implicitly `any` (TS7006).

> A first attempt to reproduce this by renaming `src/test` out of the way reported
> **0 errors** — because Windows refused the rename (`Permission denied`) and
> because `tsc -b` had reused a warm `.tsbuildinfo`. Both were false negatives.
> The reproduction above uses a separate copy and `--force`, which is why it is
> trustworthy.

## The `.vercelignore` interaction

| Path | Ignored | Needed by the old build | Needed by the new build |
| --- | --- | --- | --- |
| `src/test` | yes | **yes — this was the failure** | no |
| `tests` | yes | yes (`tsconfig.node.json` included `tests/**/*.ts`) | no |
| `scripts` | yes | listed, but matched nothing (`.mjs`, and `allowJs` is off) | no |
| `refe`, `agents`, `docs`, `test-results`, `playwright-report` | yes | no | no |

`.vercelignore` was **not changed.** Its intent — keep test-only content out of the
deployment — was correct; the build configuration was what disagreed with it.
Verified after the fix, for every ignored path:

```
refe -> app:0 node:0        tests           -> app:0 node:0
agents -> app:0 node:0      test-results    -> app:0 node:0
docs -> app:0 node:0        playwright-report -> app:0 node:0
scripts -> app:0 node:0     src/test        -> app:0 node:0
```

`scripts` stays excluded: nothing in `src/`, `api/`, `server/` or `vite.config.ts`
imports from it (`generate-pwa-icons.mjs` is a deliberate one-off that writes PNGs
into `public/`, which are committed).

---

## Build graphs

### Before

```
pnpm build → tsc -b            → tsconfig.json
pnpm typecheck → tsc -b        → tsconfig.json          ← the same graph
                                   ├── tsconfig.app.json   include: ["src"]
                                   │      · application
                                   │      · 69 test files      ← absent deps on Vercel
                                   │      · src/test/**        ← removed by .vercelignore
                                   └── tsconfig.node.json
                                          · vite.config.ts, api/**, server/**
                                          · server/**/*.test.ts
                                          · vitest.config.ts, vitest.smoke.config.ts
                                          · playwright.config.ts
                                          · tests/**            ← removed by .vercelignore
```

### After

```
pnpm typecheck → tsc -b        → tsconfig.json          ← UNCHANGED, still the full graph
                                   ├── tsconfig.app.json    (all of src, tests included)
                                   └── tsconfig.node.json   (configs, tests/** included)

pnpm build → tsc -b tsconfig.build.json
                                 → tsconfig.build.json
                                   ├── tsconfig.app.build.json
                                   │      extends tsconfig.app.json
                                   │      include src, minus *.test.*, *.spec.*, src/test
                                   │      → 142 application files, 0 test files
                                   └── tsconfig.node.build.json
                                          extends tsconfig.node.json
                                          include vite.config.ts, api/**, server/**
                                          minus server|api **/*.test.ts, tests
                                          → 20 modules + vite.config.ts, 0 test files
                                 → vite build
```

Measured after the change:

```
production app  project — test files:  0     application files: 142
production node project — test files:  0     includes vite.config.ts and both node adapters
development app project — test files: 69     (unchanged)
```

`vite.config.ts` imports `./server/jamendo/node-adapter` and
`./server/youtube/node-adapter`, so the production node project deliberately keeps
`server/**` — both adapters are present in its file list.

---

## Proof the full typecheck is unchanged

A type error was injected into `src/personalization/qualification.test.ts` and both
commands run:

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm typecheck` | **1** | `qualification.test.ts(110,7): error TS2322: Type 'string' is not assignable to type 'number'.` |
| `pnpm build` | **0** | `✓ built in 4.13s` |

The probe was then removed and `pnpm typecheck` returned to exit 0.

That is the whole point of the change: the development gate still guards test
files, and the production build no longer compiles them. `pnpm typecheck` is
byte-for-byte the same script it was.

---

## Windows → Linux case safety

`forceConsistentCasingInFileNames` was **not** added. It reads as `undefined`,
which in TypeScript 5.9 means the default — and the default is *on*, confirmed
empirically rather than from memory:

```
main.ts(1,19): error TS1149: File name '…/a.ts' differs from already included
file name '…/A.ts' only in casing.
```

So every `pnpm typecheck` on Windows has already been enforcing it. Adding the
flag would have been a no-op line.

Because TS1149 only fires when two casings of one file are both referenced, a
filesystem-level audit was run as well: every relative and `@/` import in
production source was resolved and each path segment compared byte-for-byte
against the real directory entry.

```
checked 581 relative/alias imports across 171 production files
CASE AUDIT: PASS — every import matches its file name exactly
```

No file was renamed, because no mismatch exists.

---

## Environment variables

Untouched, as required.

| Variable | Scope | Status |
| --- | --- | --- |
| `VITE_AUDIUS_API_KEY` | client | Read by `src/music/audius/client.ts`, which is in the production app project — Vite still inlines it at build time |
| `VITE_AUDIUS_APP_NAME` | client | Same |
| `JAMENDO_CLIENT_ID` | **server only** | Unchanged |
| `YOUTUBE_API_KEY` | **server only** | Unchanged |

No `VITE_JAMENDO_CLIENT_ID` or `VITE_YOUTUBE_API_KEY` was introduced. The existing
security suites that assert those names never appear in `src/` still pass (30
tests), and a scan of all 12 `dist/` files for the literal secret values found
neither.

---

## Files changed

Four files. No production source was modified.

| File | Change |
| --- | --- |
| `package.json` | `build` → `tsc -b tsconfig.build.json --pretty false && vite build`. `typecheck` unchanged. |
| `tsconfig.build.json` | **New.** Root of the production project graph; references the two below. |
| `tsconfig.app.build.json` | **New.** Extends `tsconfig.app.json`; excludes `src/test` and every `*.test.*` / `*.spec.*`; own `tsBuildInfoFile`; drops the `@testing-library/jest-dom` type entry. |
| `tsconfig.node.build.json` | **New.** Extends `tsconfig.node.json`; includes only `vite.config.ts`, `api/**`, `server/**`; excludes their test files and `tests`; own `tsBuildInfoFile`. |

`.vercelignore` — **not changed.**

Two details worth stating, since neither is required by the brief:

- **Separate `tsBuildInfoFile` per build project.** Sharing one incremental cache
  with the development project would let a `pnpm typecheck` convince a subsequent
  `pnpm build` that it was already done, over a different file set.
- **`types: ["vite/client"]` in the app build config**, dropping
  `@testing-library/jest-dom`. That is a devDependency; a production typecheck
  that needs a test-only type package is one install flag away from failing a
  deploy. It also means the production config would now reject a jest-dom matcher
  that leaked into application source. The build passes without it, which
  confirms none has.

---

## Final deterministic gate results

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | **PASS** (full development graph, 69 test files still compiled) |
| `pnpm lint` | **PASS** (`--max-warnings 0`) |
| `pnpm test:run` | **PASS** — 1330 tests, 73 files |
| `pnpm build` | **PASS** — `✓ built in 4.07s` |
| `pnpm test:e2e` | **PASS** — 273 passed, 15 skipped |
| `pnpm verify:bundle` | **PASS** — 0 matches across 12 files |

Identical to the pre-fix baseline. No test was altered to produce a green result.

## Production build result

`dist/` builds cleanly and still carries the Phase 6 PWA assets:

```
assets  index.html  manifest.webmanifest  sw.js
pulse-icon-192.png  pulse-icon-512.png  pulse-icon-maskable-512.png  pulse-mark.svg
```

Re-run inside the simulated Vercel upload — the same pruned file set that produced
68 errors before:

```
tsc -b tsconfig.build.json --force   exit=0   errors: 0
vite build                            exit=0   ✓ built in 4.12s
dist/ contains manifest.webmanifest, sw.js and all three icons
```

---

## Remaining step

Push the commit and let Vercel redeploy. Only a successful Vercel build should
change this document's status from "local PASS" to a verified deployment.
