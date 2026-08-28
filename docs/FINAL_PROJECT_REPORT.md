# Pulse — Music Discovery — Final Project Report

**Date:** 2026-08-28 · **Project:** `C:\music-platform`
**Scope:** consolidated final state across Phase 1 (Audius), Phase 2 (Jamendo), Phase 3 (YouTube
fallback) and the post-Phase-3 search-confidence correction.

---

## Status — **PASS**

Every gate is green and every provider is **live verified** against its real API with real
credentials.

| | Result |
|---|---|
| `pnpm typecheck` | **PASS** |
| `pnpm lint` (`--max-warnings 0`) | **PASS** |
| `pnpm test:run` | **PASS** — 51 files, **789** tests |
| `pnpm build` | **PASS** |
| `pnpm test:e2e` | **PASS** — **149** passed, 15 skipped |
| `pnpm verify:bundle` | **PASS** — 0 matches across 7 files |
| **Live smoke** | **26/26 PASS** |

```
AUDIUS_SMOKE=1 JAMENDO_SMOKE=1 YOUTUBE_SMOKE=1 pnpm test:smoke

  Audius     6/6   PASS
  Jamendo    8/8   PASS
  YouTube   12/12  PASS
  TOTAL     26/26  PASS
```

Detailed evidence lives in the two phase reports, which remain the authoritative record:

* `docs/PHASE3_FINAL_REPORT.md` — Phase 3 build, policy audit, Definition-of-Done audit
* `docs/SEARCH_CONFIDENCE_FINAL_REPORT.md` — the relevance correction, with before/after measurements
* `docs/youtube-policy-audit.md` — YouTube policy conclusions, quoted from official documentation
* `docs/reference-deviations.md` — every documented departure from the `refe/` design

---

## What is implemented

### Audius — implemented and live verified

The primary catalogue. Searched from the browser through `@audius/sdk` with a documented
browser-safe key. Audio streams **directly from Audius content nodes** to the one
`HTMLAudioElement`; nothing is proxied, stored or re-hosted.

Live verified: real trending tracks, real search results, real top artists, the canonical genre
vocabulary, a stream URL served by Audius rather than by this app, and real audio bytes over a range
request. **6/6.**

### Jamendo — implemented and live verified

The second catalogue, merged into the same ranked list — no provider tabs, no provider sections.
Its credential is **server-only**: the browser calls the same-origin `/api/jamendo` and the
serverless function injects `JAMENDO_CLIENT_ID`. Creative Commons attribution and a per-item
backlink are rendered on every Jamendo row, as its terms require.

Live verified: a live search through the real handler, no credential and no download URL in the
response, a non-Latin query preserved end to end, and a streamable track whose audio host actually
answers. **8/8.**

### YouTube fallback — implemented and live verified

An **explicit, opt-in** fallback for the international and mainstream releases neither independent
catalogue carries. It is a video provider, never an audio source.

* **Quota-disciplined.** A project gets 100 `search.list` calls per day for the whole deployment, so
  YouTube never runs on typing, on page load, or on an ordinary search. One deliberate press costs
  **exactly one `search.list` + one batched `videos.list`**. No autocomplete, no alias fan-out, no
  pagination, no prefetch, no retry. A repeated press for the same query in the same tab is answered
  from an in-memory session cache at no cost.
* **Compliant visible playback** — see below.
* **MadeForKids handling.** `status.madeForKids` is read before anything is embedded. Child-directed
  videos are **not embedded**: they stay visible, attributed and openable on YouTube, with the reason
  stated in words. `madeForKids === null` is treated the same as `true` — unknown is not safe.
* **Attribution.** Every result carries a plain-text **YouTube** label that is itself the link to the
  real `youtube.com/watch?v=…` page, plus the channel title and an unmodified 16:9 thumbnail, in a
  separately labelled *YouTube results* section that is never merged into `Songs`.

Live verified: one real music search, batched enrichment, embeddability and MadeForKids metadata,
safe normalization, and zero key leak. **12/12.**

### Search-confidence correction — implemented and live verified

Open-catalog results are classified by **relevance *and* query-token coverage**, so a row that
shares one generic word with a multi-token query can no longer be presented as an answer.

The case that motivated it: `aram asatryan` previously promoted `Eternos Rivales - Fil d'aram` (and
two similar rows) to Top Result on the strength of the token `aram` alone, and the mere presence of
those rows demoted the YouTube fallback to its subtle variant. All three scored 0.375 against a 0.34
floor; artist-only `Asatryan` scored 0.626, *above* the strong-relevance threshold — which is why no
score threshold could have fixed it and why coverage was added as an orthogonal signal.

Live verified: `aram asatryan` now yields 0 song rows, no Top Result, *"No strong matches found."*
and the **prominent Search YouTube** button; pressing it makes exactly one request and returns real
Aram Asatryan material.

### Smart multilingual search

One search box, four scripts, no transliteration guessing where it would be wrong.

* **Unicode-safe normalization** — NFKC, diacritic folding via NFD → strip marks → NFC, punctuation
  normalization. Scripts are never destroyed by folding.
* **Scoped homoglyph repair** — Cyrillic/Greek look-alikes are folded to Latin *only inside tokens
  that are already predominantly Latin*, which repairs the real Audius title `kosandrа` (Latin word,
  one Cyrillic `а`) while leaving a genuine Cyrillic query intact.
* **Curated aliases and bounded expansion** — transliteration groups (`kosandra` / `kassandra` /
  `кассандра`, `sara al swas` / `سارة السواس`, `miyagi` / `мияги`) plus a rule-based particle join,
  hard-capped at 4 variants and escalated only when the first answer is weak.
* **Provider requests always use the original script**; folding is for local comparison only.

Live verified across Armenian, Arabic, Cyrillic and Latin queries, including that `kosandra` and
`кассандра` return identical result sets.

### Visible, compliant YouTube iframe playback

Playback uses the **official YouTube IFrame Player API** only, in one reusable player instance, on a
surface that lives above the router so navigation cannot unmount it mid-playback.

* At least **200 × 200** always; **480 × 270** on desktop, full-width 16:9 on mobile.
* **Native controls stay on.** Nothing is drawn over the iframe — title, attribution, play/pause and
  close are all siblings placed outside it, verified in E2E by `elementFromPoint` at the stage centre.
* **No background playback.** A hidden document pauses; closing the surface stops playback and
  destroys the player.
* **Scripted playback respects visibility** — an automatic transition cues and waits unless the
  player is confirmed more than half visible. Every unknown resolves to *do not autoplay*.
* **Exactly one engine is active at a time.** A `PlaybackCoordinator` guarantees a YouTube video and
  an audio track can never play together, across all five provider transitions.
* **No extraction, download, proxying, ad blocking or hidden playback** anywhere in the codebase.
* A YouTube item **can never reach `HTMLAudioElement`** — enforced by a discriminated `MediaItem`
  union and by runtime guards on both paths.

### Server-only Jamendo and YouTube credentials

`JAMENDO_CLIENT_ID` and `YOUTUBE_API_KEY` are **never exposed to the browser**. There is deliberately
no `VITE_JAMENDO_CLIENT_ID` and no `VITE_YOUTUBE_API_KEY`, and there never may be — Vite inlines every
`VITE_*` variable into public JavaScript.

Enforced at four independent layers:

1. **Same-origin narrow endpoints.** `/api/jamendo` and `/api/youtube` are allow-listed actions, not
   proxies: GET only, one action each, a fixed set of accepted parameters, a fixed result cap the
   caller cannot raise, and a sanitized response.
2. **Response sanitization.** Only the fields the UI needs cross the wire. Jamendo's download URL and
   YouTube's statistics, etag and player payloads are dropped, with an independent re-validation on
   the browser side.
3. **Redaction.** `server/shared/redact.ts` strips `client_id`, `key`, `api_key`, bearer tokens and
   the literal credential from anything that can reach a log line — `fetch` puts the whole request
   URL into the errors it throws.
4. **`pnpm verify:bundle`.** Greps the built output for the real configured values and for forbidden
   markers (`VITE_*`, `api.jamendo.com/v3.0`, `googleapis.com/youtube/v3`, the `AIza` key prefix).
   The gate was proven live: planting a key into `dist/` makes it fail, removing it makes it pass.

### No database · No authentication · No Render backend

* **No database of any kind.** No Supabase, no Postgres, no KV, no persisted user data. The only
  thing stored on a visitor's device is player volume and mute, in `localStorage`.
* **No authentication.** No sign-up, no login, no profiles, no accounts. The site is fully usable
  the moment it loads.
* **No Render backend and no second service.** The only server-side code is two Vercel Functions,
  and each exists for exactly one reason: to hold a credential that must not reach the browser. No
  audio or video bytes pass through either.
* No listening history, no derived cross-platform popularity metric, no analytics, no advertising and
  no third-party tracking scripts of the app's own. A `/privacy` page states all of this plainly and
  links to each provider's own policy.

### Vercel-ready

`vercel.json` is committed and complete: Vite preset, `pnpm install --frozen-lockfile`,
`pnpm build` → `dist`, an SPA rewrite with a negative lookahead so `/api/*` still reaches the
functions, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`, immutable asset caching,
and `Referrer-Policy: strict-origin-when-cross-origin` — the exact value YouTube's Required Minimum
Functionality names, which the embedded player needs.

`api/jamendo.ts` and `api/youtube.ts` are picked up automatically as Vercel Functions; their shared
implementations live outside `api/`, so only the two routes become functions.

| Variable | Scope | Required | Notes |
|---|---|---|---|
| `VITE_AUDIUS_API_KEY` | build + client | yes | Documented browser-safe; inlined by design |
| `VITE_AUDIUS_APP_NAME` | build + client | optional | Usage attribution |
| `JAMENDO_CLIENT_ID` | **server only** | optional | Mark **Sensitive** |
| `YOUTUBE_API_KEY` | **server only** | optional | Mark **Sensitive** |

Both server-only variables are optional: with either blank, that provider degrades cleanly and the
rest of the app is unaffected. Step-by-step deployment and Google Cloud key setup are in `README.md`
and in `docs/PHASE3_FINAL_REPORT.md` §16.

---

## Final numbers

| Metric | Value |
|---|---|
| Unit / component tests | **789** passing across **51** files |
| E2E tests | **149** passing, 15 skipped (Chromium desktop + Pixel 5) |
| Build | **PASS** — `dist/` 1.06 kB HTML + 115 kB CSS + JS chunks |
| Bundle secret scan | **PASS** — 0 matches across 7 files (configured: `JAMENDO_CLIENT_ID`, `YOUTUBE_API_KEY`) |
| Live smoke — Audius | **6/6 PASS** |
| Live smoke — Jamendo | **8/8 PASS** |
| Live smoke — YouTube | **12/12 PASS** |
| **Live smoke — total** | **26/26 PASS** |

Normal unit and E2E runs never touch the network: MSW intercepts `api.audius.co`, `/api/jamendo` and
`/api/youtube`, Playwright intercepts those plus the YouTube IFrame API script and thumbnail CDN, and
a fake audio engine replaces the real element. Live provider traffic happens only in the opt-in smoke
suites.

---

## Known limitations

These are properties of the catalogues, the APIs and deliberate product decisions — not defects.

1. **Audius content nodes intermittently serve broken TLS.** `api.audius.co` hands out a
   community-run node per stream request and some return `ERR_SSL_PACKET_LENGTH_TOO_LONG`. The
   application routes around it at runtime (a failing origin is marked and the next attempt asks for
   a fresh URL); the single-shot live smoke has no such rotation, so it can flake. It was observed
   red during the search-confidence pass and **has since been rerun at 6/6**. Diagnosed in full in
   `docs/SEARCH_CONFIDENCE_FINAL_REPORT.md`.
2. **YouTube: 100 searches per day, deployment-wide.** A busy day can exhaust the fallback for
   everyone; the app then says so plainly and stops. Raising it requires a quota-increase application
   to Google. Key rotation to evade the limit is prohibited and is not implemented.
3. **MadeForKids videos are never embedded**, by design — no documented IFrame API mechanism lets a
   general-audience site discharge the "turn off tracking / COPPA" obligation.
4. **Coverage is threshold-based.** A two-token query needs both tokens, so a search for
   `aram asatryan` will not surface a track credited only to `Asatryan`. A deliberate trade of recall
   for precision, with the fallback covering the gap.
5. **Weak open-catalog rows are filtered out rather than shown as "possible matches"** — chosen over
   adding a new section to the reference layout.
6. **The catalogues are what they are.** Audius and Jamendo are independent-artist catalogues, so
   mainstream commercial releases are largely absent from both. That is precisely why the YouTube
   fallback exists.
7. **No Content-Security-Policy is shipped.** A correct one would have to allow the constantly
   changing set of Audius content-node hosts; a wrong one silently breaks playback.
