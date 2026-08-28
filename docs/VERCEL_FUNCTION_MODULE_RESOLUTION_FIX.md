# Vercel Function runtime fix — `ERR_MODULE_NOT_FOUND`

Both Vercel Functions built successfully and then crashed on every invocation:

```
GET /api/youtube  → 500 INTERNAL_SERVER_ERROR / FUNCTION_INVOCATION_FAILED
GET /api/jamendo  → 500 INTERNAL_SERVER_ERROR / FUNCTION_INVOCATION_FAILED
```

This document records what actually caused it, how the cause was reproduced
rather than guessed, what changed, and — precisely — what is and is not verified.

Scope: module resolution only. No application behaviour, provider logic, search
behaviour, quota behaviour, personalization, playback, PWA behaviour, API key or
environment variable was changed. The production build split from
`docs/VERCEL_BUILD_FIX.md` is unchanged.

---

## 1. Root cause

`package.json` declares:

```json
{ "type": "module", "engines": { "node": ">=20" } }
```

So the deployed Functions execute under Node's **real ESM loader**. That loader
implements the ES module specifier algorithm literally: a relative specifier is
a URL, and it is **not** extension-guessed. `'../server/youtube/handler'` is not
a request to try `handler.js`, `handler/index.js` and so on — it is a request
for a file named exactly `handler`, which does not exist.

Every relative import under `api/` and `server/` was written CommonJS-style,
without an extension:

```ts
// api/youtube.ts — before
import { handleYouTubeRequestSafely } from '../server/youtube/handler'
```

The build never had to resolve those specifiers, which is why it passed:

| stage | resolver | extensionless relative import |
| --- | --- | --- |
| `pnpm typecheck` / `pnpm build` | TypeScript, `moduleResolution: "bundler"` | accepted |
| `pnpm test:run` | Vite / Rollup | accepted (Vite guesses extensions) |
| `pnpm dev` | Vite middleware, esbuild-bundled | accepted |
| `pnpm test:e2e` | the browser bundle, already bundled by Vite | never sees them |
| **Vercel Function at invocation** | **Node ESM loader** | **`ERR_MODULE_NOT_FOUND`** |

Nothing in the repository resolved a module the way production does. Four green
gates and a green build were all consistent with a Function that could not
start.

The failure is at the **first `api/ → server/` hop**, not somewhere deep in the
tree. `api/youtube.ts` throws while loading its one and only import, before any
handler code runs — hence a crash on every request rather than a bad response.

---

## 2. Reproduction — the exact production error, locally

Not inferred. The serverless graph was compiled with a module setting that
preserves specifiers verbatim, marked as ESM, and loaded by Node:

```jsonc
// tsconfig.esm-repro.json (temporary, deleted afterwards)
{
  "compilerOptions": {
    "module": "ESNext",        // emits specifiers unchanged
    "outDir": "./.esm-repro-out",
    "noEmit": false,
    "rootDir": "."
  },
  "include": ["api/**/*.ts", "server/**/*.ts"],
  "exclude": ["server/**/*.test.ts", "server/**/*.spec.ts", "api/**/*.test.ts"]
}
```

with `{ "type": "module" }` written into the output directory, then
`await import('./api/youtube.js')` under Node v24.13.0.

**Before the fix** — the production error, verbatim:

```
CODE: ERR_MODULE_NOT_FOUND
MSG:  Cannot find module 'C:\music-platform\.esm-repro-out\server\youtube\handler'
      imported from C:\music-platform\.esm-repro-out\api\youtube.js
```

and the equivalent for `api/jamendo.js`.

**After the fix**, the same harness:

```
LOADED  ./api/youtube.js  exports: [GET, POST]
LOADED  ./api/jamendo.js  exports: [GET, POST]
ESM_LOAD_RESULT=PASS
```

Loading is sufficient proof of the whole graph, because the graph is entirely
static — there is no `import()`, no `require()`, no `createRequire`, no
`__dirname` and no `import.meta` anywhere under `api/` or `server/`. A
successful import of the entrypoint has already resolved every module beneath it.

The same harness also ran the handlers end to end, with credentials removed:

| function | request | result |
| --- | --- | --- |
| `api/youtube.ts` | `?action=search&q=hello` | HTTP 503 `UNAVAILABLE` |
| `api/youtube.ts` | `?action=bogus` | HTTP 400 `BAD_REQUEST` |
| `api/jamendo.ts` | `?action=search&q=hello` | HTTP 503 `UNAVAILABLE` |
| `api/jamendo.ts` | `?action=bogus` | HTTP 400 `BAD_REQUEST` |

Documented statuses, produced by real Node ESM execution. The reproduction
directory and its tsconfig were deleted; nothing from it remains in the tree.

---

## 3. The fix

Every relative specifier under `api/` and `server/` now carries an explicit
`.js` extension — the standard TypeScript ESM source style, in which the
compiler resolves `./foo.js` to `foo.ts` while emitting a specifier Node can
actually load:

```ts
// api/youtube.ts — after
import { handleYouTubeRequestSafely } from '../server/youtube/handler.js'
```

```
31 files changed, 75 insertions(+), 75 deletions(-)
```

75 changed lines for 75 rewritten specifiers: one line each, nothing else. The
diff contains no statement other than import and export specifiers.

Bare npm package specifiers were deliberately left untouched — Node resolves
those through `node_modules` and package `exports`, where an invented `.js`
suffix breaks a package that previously worked. As it happens, **neither
Function graph imports a third-party package at all**; both run entirely on
Web-standard globals (`Request`, `Response`, `fetch`, `URL`,
`AbortController`), which is also why Vercel's file tracing never had a problem
finding what to upload. Packaging was never the fault; the specifier was.

### What was *not* changed, and why

- **`vite.config.ts`** still imports `./server/*/node-adapter` extensionless. It
  is only ever loaded by Vite, which bundles it with esbuild — Node's ESM loader
  never sees that file, so it is not a runtime hazard, and it sits outside this
  change's scope.
- **`.vercelignore`** — verified, unchanged. It excludes `refe`, `agents`,
  `docs`, `tests`, `test-results`, `playwright-report`, `src/test` and
  `scripts`. It excludes neither `api/**` nor `server/**`, so the Functions and
  the handlers they import were always uploaded. No test infrastructure was
  added to the upload to make packaging work.
- **Environment variables** — untouched. `.env` still holds exactly
  `VITE_AUDIUS_API_KEY`, `VITE_AUDIUS_APP_NAME`, `JAMENDO_CLIENT_ID`,
  `YOUTUBE_API_KEY`. No variable was renamed; `VITE_YOUTUBE_API_KEY` and
  `VITE_JAMENDO_CLIENT_ID` were not introduced; the two server credentials
  remain un-prefixed and therefore server-only. `pnpm verify:bundle` re-confirms
  neither reaches `dist/`.

### TypeScript configuration — audited, unchanged

`tsconfig.node.json` uses `module: "ESNext"` with
`moduleResolution: "bundler"`, and `tsconfig.node.build.json` inherits it.

`bundler` resolution **already understands** `./foo.js` → `foo.ts`, so the fix
typechecks as-is (`pnpm typecheck` exit 0). Its one weakness is that it also
still *accepts* an extensionless specifier, so the compiler alone will not stop
this regressing.

Switching to `moduleResolution: "NodeNext"` would make the compiler enforce it,
and was rejected as the wrong trade:

- `tsconfig.node.json` is shared with `vite.config.ts`, both Vitest configs, the
  Playwright config, `tests/**` and `scripts/**`, all of which are legitimately
  bundler-resolved. Changing the shared base breaks them.
- Changing only `tsconfig.node.build.json` would leave `pnpm typecheck` — which
  resolves the *development* graph — still accepting the bug, so it would be
  caught only at `pnpm build`, later and in a worse place.

Neither of these files is emitted by TypeScript anyway (`noEmit: true`); Vercel
transpiles them itself, so the tsconfig `module` setting has no effect on what
production runs. The smallest correct change to the configuration was therefore
**none**, and the enforcement gap is closed by a test instead — one that runs in
`pnpm test:run` and covers the development graph too.

---

## 4. Regression test

`server/module-resolution.test.ts` — 8 deterministic tests, no network, no
platform assumptions. Paths are normalised to POSIX form and every filesystem
access goes through `node:path`, so it reads identically on Windows, macOS and
Linux CI.

It traverses the real import graph from both entrypoints and asserts:

1. every module each entrypoint imports actually resolves,
2. neither entrypoint reaches outside `api/` and `server/`,
3. no test or smoke-harness module is reachable from a Function,
4. no relative specifier under `api/` or `server/` is extensionless,
5. every relative specifier points at a file that exists,
6. no bare package import was given a `.js` suffix — the opposite mistake, and
   an easy one to make while fixing the first.

**Mutation-checked.** Reverting the single specifier in `api/youtube.ts` back to
`'../server/youtube/handler'` turns three of the eight red, each naming the
offending edge:

```
× api/youtube.ts reaches every module it imports
× leaves none extensionless anywhere under api/ or server/
× points every one of them at a file that exists
    + "api/youtube.ts -> ../server/youtube/handler"
```

The specifier was restored immediately afterwards.

---

## 5. Import audit

Zero extensionless relative runtime imports in either Function graph.

### `api/youtube.ts` — 6 modules

| depth | module | relative specifiers | extensionless |
| --- | --- | --- | --- |
| 0 | `api/youtube.ts` | `../server/youtube/handler.js` | 0 |
| 1 | `server/youtube/handler.ts` | `../shared/redact.js`<br>`./env.js` ×2<br>`./sanitize.js` ×2<br>`./upstream.js` | 0 |
| 2 | `server/shared/redact.ts` | _none_ | 0 |
| 2 | `server/youtube/env.ts` | _none_ | 0 |
| 2 | `server/youtube/sanitize.ts` | `../shared/redact.js` | 0 |
| 2 | `server/youtube/upstream.ts` | `../shared/redact.js`<br>`./sanitize.js` ×2 | 0 |

### `api/jamendo.ts` — 7 modules

| depth | module | relative specifiers | extensionless |
| --- | --- | --- | --- |
| 0 | `api/jamendo.ts` | `../server/jamendo/handler.js` | 0 |
| 1 | `server/jamendo/handler.ts` | `./env.js` ×2<br>`./redact.js`<br>`./sanitize.js` ×2<br>`./upstream.js` | 0 |
| 2 | `server/jamendo/env.ts` | _none_ | 0 |
| 2 | `server/jamendo/redact.ts` | `../shared/redact.js` | 0 |
| 2 | `server/jamendo/sanitize.ts` | `./redact.js` | 0 |
| 2 | `server/jamendo/upstream.ts` | `./redact.js`<br>`./sanitize.js` ×2 | 0 |
| 3 | `server/shared/redact.ts` | _none_ | 0 |

### Whole shipped surface

| metric | value |
| --- | --- |
| shipped modules under `api/` + `server/` (tests excluded) | 20 |
| relative specifiers among them | 45 |
| **extensionless** | **0** |
| bare package specifiers wrongly given `.js` | 0 |

Neither graph reaches `server/*/index.ts`, `server/*/node-adapter.ts`, any
`smoke-*` module or any `*.test.ts` — the dev-server adapters and the test
harness stay out of the Functions.

---

## 6. Verification

| check | result |
| --- | --- |
| `pnpm typecheck` | **PASS** — exit 0 |
| `pnpm lint` | **PASS** — exit 0, `--max-warnings 0` |
| `pnpm test:run` | **PASS** — 1338 tests, 74 files (1330 baseline + 8 new) |
| `pnpm build` | **PASS** — exit 0, all assets emitted |
| `pnpm test:e2e` | **PASS** — 273 passed, 15 skipped |
| `pnpm verify:bundle` | **PASS** — 0 matches across 12 files in `dist/` |
| Node ESM load of both Functions | **PASS** — `GET`/`POST` exported, no `ERR_MODULE_NOT_FOUND` |
| Node ESM end-to-end invocation | **PASS** — documented 503/400 statuses |
| Regression test mutation check | **PASS** — 3 of 8 fail when the bug is reintroduced |

No test was modified to produce any of these results. The only test file touched
is the new one; every other change in the diff is an import specifier.

### Local `pnpm dev`

| request | status | body |
| --- | --- | --- |
| `/api/jamendo?action=search&q=hello` | **200** | `{"provider":"jamendo","action":"search","query":"hello","count":0,"results":[]}` |
| `/api/jamendo?action=similar&id=1886794` | **200** | similar envelope |
| `/api/youtube?action=search&q=hello` | **429** | `error.code = QUOTA` |

YouTube's daily `search.list` allowance is spent, so 429 is the documented,
correct response — a healthy non-crash answer from the handler, not a defect.
It was requested once and not retried.

> **Observed, out of scope, pre-existing:** Jamendo intermittently answers
> `headers.status: "success"` with `results_count: 0` for queries that should
> match — 3 of 5 consecutive identical `q=rock` calls came back empty, 2 returned
> 20 tracks. Confirmed to originate **upstream**: the same flake appears when
> calling `api.jamendo.com` directly with the documented parameters, outside
> Pulse entirely. It is unrelated to this fix — the diff changes only import
> specifiers, not a single line of query construction — and it is left alone
> here because provider logic and search behaviour were explicitly out of scope.
> Worth its own investigation.

### Vercel CLI packaging inspection — **NOT PERFORMED**

Attempted and recorded rather than assumed. `vercel` is not installed locally
and there is no `.vercel/` project link. `pnpm dlx vercel@latest build --yes`
downloaded and started **Vercel CLI 59.9.1**, then stopped at authentication:

```
Loading teams…
Error: The specified token is not valid. Use `vercel login` to generate a new token.
```

So `.vercel/output/functions/` could not be produced or inspected in this
environment. Per the fallback, Node ESM resolution was reproduced locally
instead, which is what section 2 records.

---

## 7. Production status — **NOT VERIFIED**

The fix is committed to the working tree only. It has **not** been pushed, and
Vercel has **not** redeployed.

`GET /api/youtube` and `GET /api/jamendo` in production are therefore still
running the crashing build. This document does **not** claim a production pass.

To close it out:

1. Commit and push to `main`.
2. Let Vercel redeploy.
3. Request both endpoints on the deployed URL and confirm neither returns
   `500 FUNCTION_INVOCATION_FAILED`:
   - `/api/jamendo?action=search&q=hello` → expect **200** with the search
     envelope (or a documented 4xx/5xx, never a crash).
   - `/api/youtube?action=search&q=hello` → expect **200**, or **429** while the
     daily quota is spent, or **503** if `YOUTUBE_API_KEY` is not set on the
     deployment. All three are non-crash responses that prove the module loaded.
4. Check the Function logs contain no `ERR_MODULE_NOT_FOUND`.

Only after step 3 returns non-crash responses is the production runtime fixed.

---

## 8. Files changed

| file | change |
| --- | --- |
| `api/youtube.ts`, `api/jamendo.ts` | 1 specifier each |
| `server/**/*.ts` (29 files, handlers and their co-located tests) | 73 specifiers |
| `server/module-resolution.test.ts` | **new** — the regression test |
| `docs/VERCEL_FUNCTION_MODULE_RESOLUTION_FIX.md` | **new** — this document |

No configuration file, no test other than the new one, and no application code
was modified.
