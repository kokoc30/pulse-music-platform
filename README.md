# Pulse — Music Discovery

A public music-discovery web app. Open it, search, click a track, and it plays — no account, no
signup, no database. Catalogue, metadata, artwork and audio come from two third-party providers:
[Audius](https://audius.co) and [Jamendo](https://www.jamendo.com), with
[YouTube](https://www.youtube.com) available as an **explicit, opt-in fallback** for the
international and mainstream releases neither independent catalogue carries.

**Open → Search → Results → Click → Audio plays.** That is the whole product.

You search once and get **one ranked list**. There are no provider tabs and no provider sections —
which catalogue answered is an implementation detail, visible only as the source credit each
provider's licence requires.

---

## Architecture

A single-page browser application plus **one serverless function**, whose only job is to hold the
Jamendo credential — see [Why one function](#why-one-function).

```
React 19 + TypeScript (strict) + Vite 7
        │
        ├── React Router 7          /  ·  /search?q=  ·  *
        ├── Zustand 5               global playback state
        ├── @audius/sdk 16          provider #1  (browser-side, browser-safe key)
        ├── /api/jamendo            provider #2  (server-side credential)
        ├── /api/youtube            provider #3  (server-side key, fallback only)
        ├── one HTMLAudioElement    the only audio engine — Audius + Jamendo
        └── one YouTube IFrame      the official embedded player — YouTube only
```

```
UI components
     │
feature hooks  (useTrackSearch, useDiscovery)  ·  player actions
     │
multi-provider aggregator      ← expand · search · merge · dedupe · rank
     │                                                       │
     ├── Audius smart search ───────────────────┐            │
     │        │                                 │            │
     │   MusicProvider interface                │      one ranked list
     │        │                                 │
     │   api.audius.co                          │
     │                                          │
     └── Jamendo client  →  /api/jamendo  ──────┘
                                  │
                          Vercel Function
                                  │  injects JAMENDO_CLIENT_ID (server-only)
                                  ▼
                          api.jamendo.com/v3.0/tracks/
                                  │
                          sanitized metadata + Jamendo's own stream URL
```

Playback for **both** providers goes through the one `<audio>` element, and audio bytes go
**straight from the provider to the listener's browser**:

```
Audius content node  ─┐
                      ├─→  <audio>
Jamendo storage      ─┘
```

Nothing is proxied, cached, stored or re-hosted by this application. In particular the serverless
function carries **metadata only** — it never sees a byte of audio.

### Layout

| Path | Contents |
|---|---|
| `src/app/` | `App`, `router`, cross-cutting UI store |
| `src/components/` | `layout/` `navigation/` `search/` `track/` `player/` `queue/` `feedback/` |
| `src/features/` | `discovery/` `search/` `playback/` — hooks and feature composition |
| `src/music/` | `types` `provider` `normalize` + `audius/{client,adapter,errors,genres,content-nodes}` |
| `src/music/search/` | smart search: `text` `aliases` `expand` `similarity` `relevance` `smart-search` |
| `src/player/` | `audio-engine` `player-store` `player-actions` `player-selectors` |
| `src/styles/` | `tokens.css` (design tokens) · `app.css` (ported reference CSS) · `additions.css` |
| `src/test/` | setup, MSW handlers, fixtures, render harness, opt-in real-provider smoke |
| `tests/e2e/` | Playwright specs |
| `docs/` | reference audit, route map, component map, deviations, screenshots |
| `refe/` | the design reference — **read-only, never imported at runtime** |
| `agents/` | the implementation contract |

Three boundaries are load-bearing:

* **`MusicProvider`** (`src/music/provider.ts`) — no component ever imports `@audius/sdk`. Raw
  provider shapes are normalized into `Track` / `Artist` at the adapter and never travel further.
* **`AudioEngine`** (`src/player/audio-engine.ts`) — exactly one `HTMLAudioElement` exists, created
  once and attached to the document. Tests inject a deterministic fake through the same seam.
* **`src/styles/`** — a token layer holding the reference's exact values, so no magic hex is
  scattered through components.

### Search

Audius ranks by substring, which fails in two directions: it returns confident nonsense
(`sara al swas` → `djwashiwasha`, `JesusWasARapper`) and it misses real releases indexed under a
different spelling (`kassandra` and `кассандра` never reach the track titled `Kosandra`).
`src/music/search/` wraps the provider to fix both:

1. **Normalize** — NFKC, punctuation folding, diacritic stripping via NFD → strip marks → NFC, and
   *scoped* homoglyph repair. Scoped matters: blind folding would turn `кассандра` into
   `kaccahdpa`, so only tokens that are already predominantly Latin are repaired — which is what
   rescues the real Audius title `kosandrа` (final character U+0430). **The provider always receives
   the original text**; folding is for local comparison only.
2. **Expand** — a small, data-driven alias table (`aliases.ts`) plus one dictionary-free rule
   (particle joining: `sara al swas` → `sara alswas`). Capped at four variants.
3. **Search** — one `/search/full` call returns tracks *and* artists. A confidently matched artist
   also has their catalogue pulled, which is why `Skrillex` returns Skrillex's own track rather than
   a page of remixes naming him.
4. **Merge and rank** — de-duplicated by provider track id, each track scored against *every* variant
   searched, best score wins. Scoring blends title and artist with token coverage, word-boundary
   containment, and length-proportionate prefix/fuzzy matching. Popularity is capped at 0.05 and can
   only break ties.
5. **Threshold** — anything below `MIN_RELEVANCE` is dropped. If nothing survives, the UI says
   **"No strong matches found on Audius."** rather than promoting the closest coincidence.

**Request budget:** at most four provider calls per search, usually one or two. Variants are only
paid for when the first answer is weak or the query has a curated alias. Search stays debounced at
300 ms and stale-request safe.

Adding a transliteration means adding a row to `aliases.ts`. No component changes, no code changes.

---

## Prerequisites

* **Node 20+** (developed on 24)
* **pnpm 10** — `corepack enable && corepack prepare pnpm@10.4.1 --activate`

---

## Setup

```bash
pnpm install
cp .env.example .env.local     # then paste your key
pnpm dev                       # http://localhost:5173
```

### Audius API key

1. Go to the Audius developer documentation at <https://docs.audius.co> and follow the
   *Developer Apps* flow to create an app.
2. Copy the generated **API key** into `.env.local`:

```env
VITE_AUDIUS_API_KEY=your_key_here
VITE_AUDIUS_APP_NAME=Pulse Music Platform   # optional
```

| Variable | Required | Notes |
|---|---|---|
| `VITE_AUDIUS_API_KEY` | recommended | Audius documents the API key as safe for browser use, so it is deliberately exposed through Vite's `VITE_` prefix. |
| `VITE_AUDIUS_APP_NAME` | optional | Usage attribution. Defaults to `Pulse Music Platform`. |

**Never** put an Audius bearer token, API secret or private key in a `VITE_` variable — everything
with that prefix is inlined into the public bundle. The app never reads one.

Without a key the app still runs: Audius supports read-only public access identified by app name
alone, and the SDK itself warns that such requests get lower rate limits. In development this prints
a loud console error so the misconfiguration cannot go unnoticed. **Set the key for anything
deployed.**

### Jamendo client id — server only

1. Create an application at <https://devportal.jamendo.com> and copy its **client id**.
2. Put it in `.env.local` **without** a `VITE_` prefix:

```env
# SERVER ONLY — never exposed to the browser
JAMENDO_CLIENT_ID=your_client_id_here
```

| Variable | Required | Notes |
|---|---|---|
| `JAMENDO_CLIENT_ID` | optional | **Server-only.** Read by the `/api/jamendo` function and by the Vite dev/preview middleware. Never reaches the browser. |

There is deliberately **no `VITE_JAMENDO_CLIENT_ID`, and there never may be.** Jamendo's developer
terms treat the client id as a personal credential that must not be disclosed, and a `VITE_`
variable is compiled verbatim into the public JavaScript. The browser therefore never calls
`api.jamendo.com` for metadata — it calls the same-origin `/api/jamendo`, and the function adds the
credential server-side. This is enforced three ways: source-level tests that fail if `src/` ever
mentions the forbidden variable or the Jamendo API host, response sanitization on the server, and
`pnpm verify:bundle`, which greps the built output for the real credential.

**Leaving `JAMENDO_CLIENT_ID` blank is fully supported.** Jamendo is simply unavailable, the search
runs on Audius alone, and nothing in the UI mentions a configuration problem.

`pnpm dev` and `pnpm preview` serve `/api/jamendo` locally through the *same* handler the Vercel
function uses, so local and production behaviour cannot drift. You do not need a Vercel login, a
separate backend, or `vercel dev`.

`.env*` is git-ignored except `.env.example`.

### YouTube API key — server only

The YouTube fallback is **optional**. Skip this whole section and the app works exactly as it did
before: Audius and Jamendo carry the search, and the fallback reports itself unavailable if anyone
presses it.

To enable it:

1. Open the [Google Cloud console](https://console.cloud.google.com/) and **create a project**, or
   select an existing one.
2. Go to **APIs & Services → Library**, search for **YouTube Data API v3**, and press **Enable**.
3. Go to **APIs & Services → Credentials → Create credentials → API key**.
4. Press **Edit API key** on the new key, and under **API restrictions** choose **Restrict key** →
   **YouTube Data API v3**. This is the restriction that matters: it means a leaked key can only
   spend your YouTube quota rather than reach every Google API you have enabled.
   *Application restrictions* are left as **None** on purpose — Vercel's function egress comes from
   a dynamic, undocumented IP range, so an IP allow-list would break in production without warning,
   and an HTTP-referrer restriction does not apply to a server-side call at all. The key is never
   exposed to a browser, so there is no referrer to restrict.
5. Copy the key into `.env.local` **without** a `VITE_` prefix:

```env
# SERVER ONLY — never exposed to the browser
YOUTUBE_API_KEY=your_api_key_here
```

6. Add the same variable in Vercel under **Settings → Environment Variables**, marked **Sensitive**.
7. **Never commit it.** `.env*` is git-ignored except `.env.example`.

| Variable | Required | Notes |
|---|---|---|
| `YOUTUBE_API_KEY` | optional | **Server-only.** Read by the `/api/youtube` function and by the Vite dev/preview middleware. Never reaches the browser. |

There is deliberately **no `VITE_YOUTUBE_API_KEY`, and there never may be.** A `VITE_` variable is
compiled verbatim into the public JavaScript, and a Google API key in public JavaScript is a key
anyone can spend against your daily quota. The same three enforcement layers Jamendo uses apply
here: source-level tests that fail if `src/` ever mentions the forbidden variable or the
`googleapis.com` host, response sanitization on the server, and `pnpm verify:bundle`, which greps
the built output for the real key, for `VITE_YOUTUBE_API_KEY`, for `googleapis.com/youtube/v3` and
for the `AIza` prefix every Google key carries.

---

## The YouTube fallback

### Why it is a button, not a provider

The other two catalogues run on every search. YouTube cannot, and the reason is quota rather than
taste.

A Google Cloud project gets a **default allocation of 100 `search.list` calls per day** — for the
whole deployment, shared by every visitor
([quota reference](https://developers.google.com/youtube/v3/determine_quota_cost)). That is about
four searches an hour. A debounced type-ahead would spend the entire day's allowance on one visitor
typing one word.

So YouTube runs **only on an explicit press**:

```
User searches
   │
   ▼
Audius + Jamendo (as before, on every keystroke, debounced)
   │
   ├── strong results ──▶ normal list  ·  [ Search YouTube for more ]   ← subtle
   │
   └── nothing / no strong match ──▶ [ Search YouTube ]                 ← prominent
                                            │
                                            ▼
                                    "YouTube results" section
```

One press costs exactly **one `search.list` + one batched `videos.list`** — 1 unit from the search
bucket, 1 from the general pool. There is no autocomplete, no alias fan-out, no automatic
pagination, no prefetch and no retry. Pressing again for the same query in the same tab is answered
from an in-memory session cache and costs nothing.

An exhausted quota shows *"YouTube search is temporarily unavailable. Try again later."* and stops
there. Rotating keys or projects to get around a quota is prohibited and is not implemented.

### YouTube is a video provider, not an audio source

```
Audius  ─┐
         ├─▶ HTMLAudioElement   (one element, as before)
Jamendo ─┘

YouTube ───▶ official YouTube IFrame Player, visible on the page
```

The app never separates a YouTube video's audio, never downloads, caches, re-hosts or proxies
audiovisual content, never uses a hidden or background player, never blocks or alters ads, and never
covers the player's native controls. `YouTubeVideoItem` is a different type from `Track` and has no
field that could be handed to an `<audio>` element; a runtime guard backs the type system at the one
boundary types cannot police.

While a video is loaded, a **visible player surface** sits above the bottom bar — 480 × 270 on
desktop, full width and 16:9 on a phone, never below the documented 200 × 200 minimum. It lives
above the router, so navigating does not interrupt playback. Closing it stops playback; hiding the
tab pauses it. Nothing is ever drawn on top of the iframe: the title, the attribution, the watch
link, the play/pause button and the close button are all siblings placed outside it.

Every YouTube result shows its **unmodified 16:9 thumbnail** (never cropped into square album art),
its title, its channel, its duration, and a real link to `youtube.com/watch?v=…`. They render in
their own labelled **"YouTube results"** section and are never merged into `Songs`.

### Videos that are not embedded

A result whose `status.madeForKids` is `true` — or is not reported at all — is **not embedded**. The
documented obligation for child-directed content is to *"turn off tracking and make sure that all
data collection, with respect to that player, is compliant with applicable laws, including COPPA"*,
and the IFrame Player API documents no mechanism that lets a general-audience site discharge that.
Rather than guess, the result stays visible, attributed and openable on YouTube, with the reason
stated in words. Videos whose uploader disabled embedding, and live broadcasts, are handled the same
way. The reasoning is written up in [docs/youtube-policy-audit.md](docs/youtube-policy-audit.md) §9.

### Referrer

YouTube's Required Minimum Functionality states that API clients using the embedded player *"must
provide identification through the `HTTP Referer` request header"*, recommends
`strict-origin-when-cross-origin`, and forbids the `noreferrer` feature. `vercel.json` has sent
exactly that policy since Phase 1, `index.html` sets no `<meta name="referrer">`, and no
YouTube-related link uses `rel="noreferrer"` — all three are covered by tests.

### Privacy

`/privacy` states, in plain words, what leaves the visitor's browser: no account and no database;
three external providers; a YouTube search only on an explicit press; and, on playback, that YouTube
and Google may receive request and playback data exactly as they would on youtube.com. No YouTube
script is fetched at all until the first video is played.


---

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server on :5173 |
| `pnpm build` | `tsc -b` then `vite build` → `dist/` |
| `pnpm preview` | Serve the built app on :4173 |
| `pnpm typecheck` | `tsc -b` across app + tooling projects |
| `pnpm lint` | ESLint, type-aware, `--max-warnings 0` |
| `pnpm test` | Vitest watch |
| `pnpm test:run` | Vitest once — unit + component |
| `pnpm test:e2e` | Playwright (builds are served by `vite preview`) |
| `pnpm test:smoke` | **Opt-in**, hits a live provider — see below |
| `pnpm verify:bundle` | Greps `dist/` for the real Jamendo and YouTube credentials, and for forbidden markers |
| `pnpm format` | Prettier |

The smoke suites are opt-in per provider and never run as part of `pnpm test:run`:

```bash
AUDIUS_SMOKE=1  pnpm test:smoke     # live Audius
JAMENDO_SMOKE=1 pnpm test:smoke     # live Jamendo
YOUTUBE_SMOKE=1 pnpm test:smoke     # live YouTube Data API — spends real quota, see below
AUDIUS_SMOKE=1 JAMENDO_SMOKE=1 YOUTUBE_SMOKE=1 pnpm test:smoke   # all three
```

`YOUTUBE_SMOKE=1` makes **one** real `search.list` call and **one** batched `videos.list` call — 1
unit out of the project's 100-per-day search bucket and 1 unit out of the 10,000-per-day general
pool. The suite is written around a single shared response for exactly that reason; do not add a
second search to it.

### Quality gate

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
pnpm verify:bundle
```

---

## Testing

Unit and component tests are **deterministic** — MSW intercepts `https://api.audius.co` (which the
installed SDK pins as its production base path) and the same-origin `/api/jamendo` route, and a fake
audio engine replaces the real element (jsdom cannot decode audio). Nothing in `pnpm test:run` or
`pnpm test:e2e` touches the network.

The Jamendo route answers **empty by default** in tests, so every Phase 1 test still sees exactly the
Audius-only result set it was written against; a test opts into the second catalogue with
`server.use(jamendoHandlers.withResults())`.

The serverless handler is unit-tested directly in `server/jamendo/`, with `fetch` injected — method,
action and parameter allow-listing, limit clamping, UTF-8 preservation, envelope validation, error
mapping, output sanitization and credential redaction.

Playwright stubs both providers at the network layer and serves a locally generated 2-second silent
WAV for each provider's stream URL, so the real `<audio>` element genuinely loads, plays, seeks and
fires `ended` — without depending on a live service or a copyrighted stream. `tests/e2e/multi-provider.spec.ts`
covers the merged list, Jamendo attribution and safe link attributes, Audius↔Jamendo↔Jamendo
switching on the one audio element, navigation persistence, mobile, each single-provider outage, both
providers down, and the absence of any direct browser request to `api.jamendo.com`.

`pnpm test:smoke` holds the two suites that call a live provider, each gated behind its own flag:

* `AUDIUS_SMOKE=1` — trending, search, top artists, the canonical genre vocabulary, that stream URLs
  resolve to Audius origins (never this app's), and that those URLs serve real audio bytes over a
  range request.
* `JAMENDO_SMOKE=1` — runs the *actual* serverless handler against
  the live Jamendo API: a real search, normalization into the shared model, an HTTPS source URL and
  audio URL, the credential's absence from the response, a non-Latin query round-trip, and a
  HEAD/1-byte-range availability probe. It never downloads a whole track.

`JAMENDO_CLIENT_ID` does not need exporting by hand: `vitest.smoke.config.ts` reads the project's
`.env` files with Vite's own `loadEnv` — the same mechanism the dev server uses, and no dotenv
dependency — and injects only that one allow-listed server-side key into the smoke process. A value
already exported in the shell or CI always wins and is never overwritten by a file. `pnpm test:run`
is untouched by this and still passes on a machine that has never seen a Jamendo credential.

Screenshot capture for the reference-fidelity loop:

```bash
node scripts/capture-screenshots.mjs --base http://localhost:4173 --out test-results/production
```

---

## Deploying to Vercel

`vercel.json` is committed and configures everything:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build` |
| Output directory | `dist` |

1. Import the repository into Vercel. **One** project — there is no second service and no Render
   deployment.
2. Add these under **Settings → Environment Variables** (Production, Preview, Development):

   | Variable | Scope | Notes |
   |---|---|---|
   | `VITE_AUDIUS_API_KEY` | build + client | Inlined into the bundle by design; Audius documents it as browser-safe. |
   | `JAMENDO_CLIENT_ID` | **server only** | Mark it **Sensitive**. Read by the function at runtime; never inlined. |
   | `YOUTUBE_API_KEY` | **server only** | Mark it **Sensitive**. Read by the `/api/youtube` function at runtime; never inlined. Optional — without it the fallback reports itself unavailable and Audius + Jamendo are unaffected. |
   | `VITE_AUDIUS_APP_NAME` | optional | Usage attribution. |

3. Deploy. Redeploy after any environment change — `VITE_` values are baked in at build time.

`api/jamendo.ts` and `api/youtube.ts` are picked up automatically as Vercel Functions (Node.js
runtime, Web-standard handlers). Their shared implementations live in `server/jamendo/` and
`server/youtube/`, outside `api/`, so only the routes themselves become functions.

`vercel.json` also ships:

* an **SPA rewrite** — `/((?!api/).*)` → `/index.html`, so `/search?q=drake` survives a hard refresh
  while `/api/jamendo` still reaches the function. The negative lookahead is deliberate and is
  covered by a test: a bare `/(.*)` would match the API route too, and relying on Vercel's
  filesystem-before-rewrites ordering to save it is an implicit dependency this project does not
  want. Static files (`/assets/*`, `/pulse-mark.svg`) are resolved before rewrites either way;
* `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`;
* immutable caching for `/assets/*`.

No Content-Security-Policy is shipped. A correct one would have to allow `api.audius.co`, the
constantly-changing set of Audius content-node hosts that serve artwork and audio, and Google Fonts;
a wrong one silently breaks playback, which `agents/10_SECURITY_ENV_DEPLOYMENT.md` explicitly warns
against.

### Post-deploy check

Open the production URL in a private window and confirm: search returns results from both
catalogues → a Jamendo track plays → switch to an Audius track and back → pause/resume → seek →
next/previous → refresh the homepage → hard-refresh `/search?q=house` → mobile viewport.

Then check the network panel:

* `GET /api/jamendo?action=search&…` returns **200** from your own domain — not `index.html`;
* `GET /api/youtube?action=search&q=test` returns **200** with a `results` array — or **503** if you
  did not configure a key — again from your own domain, not `index.html`;
* pressing **Search YouTube** issues exactly one `/api/youtube` request, and typing issues none;
* the document response carries `Referrer-Policy: strict-origin-when-cross-origin`. YouTube names
  this value explicitly, and the embedded player needs the `Referer` it preserves;
* audio is served by an Audius content node or by `*.storage.jamendo.com`, **not** by your Vercel
  domain;
* no request from the browser goes to `api.jamendo.com`;
* no bearer token, and no Jamendo client id, anywhere in the bundle (`pnpm verify:bundle`).

### Why one function

Audius stays entirely in the browser: its API key is documented as browser-safe, so a server would
add a failure domain and buy nothing.

Jamendo is different. Its developer terms treat the client id as a credential that must not be
disclosed, and Vite inlines every `VITE_` variable into public JavaScript — so there is no way to
call Jamendo directly from the browser without publishing the credential. **That is the single
reason `/api/jamendo` exists.**

Its scope is deliberately minimal: one route, `GET` only, one allow-listed action, three
allow-listed parameters, a clamped limit, and a sanitized response. It is **not** a Jamendo proxy —
nothing the caller sends is forwarded upstream except the search text and the limit. Audio never
touches it, so it cannot become a bandwidth bottleneck or an accidental re-hosting service.

Still not deployed: any database, authentication, user accounts, a Render service, or a second
backend of any kind.

---

## Known limitations

These are properties of the catalogue and the network, not of the app.

* **Catalogue.** These are the Audius and Jamendo catalogues, not "every song ever recorded". Both
  are independent-artist catalogues, so mainstream commercial releases are largely absent from each;
  searches for major-label tracks often return remixes, DJ sets or covers. Availability also differs
  sharply between the two — a title on one is frequently absent from the other, which is precisely
  why searching both is worthwhile. When nothing relevant exists in either, the app says **"No strong
  matches found."** — a statement about the catalogues, not a bug. Verified example: no Sara Al Sawas
  recording exists on Audius under any of `sara al swas`, `sara al sawas` or `سارة السواس`.
* **Jamendo coverage.** Jamendo is queried for **tracks only**. Its artists, albums and playlists are
  not used, so the artist shelf and the discovery rows remain Audius-only; Phase 2 adds Jamendo to
  *search and playback*. Jamendo also reports no play counts, so its rows carry no popularity signal
  — the ranking compensates by deciding cross-provider order on exactness and text relevance first,
  and only then on popularity, so the catalogue that reports play counts cannot win ties by default.
* **Request budget.** Jamendo receives the original query always, plus at most **one** alternate
  script/spelling variant, and only when the first answer was weak. Audius keeps its Phase 1 ceiling
  of four requests. One search therefore costs at most six provider round-trips.
* **Cross-provider duplicates.** The same recording on both catalogues is collapsed into one row, but
  only when title, artist and duration all agree closely and no remix/live/acoustic/instrumental
  marker conflicts. The rule is deliberately conservative: a visible duplicate is a much smaller
  failure than a distinct recording silently deleted, so borderline pairs are left as two rows.
* **Search relevance.** Ranking is local and heuristic. Thresholds live in
  `src/music/search/relevance.ts` and are calibrated against real API responses; a genuinely obscure
  release with an unusual title can in principle fall below the bar. Aliases are curated, so a
  transliteration nobody has added yet will not be expanded.
* **Gated tracks.** Some Audius tracks are premium, NFT-gated or unavailable. They are shown with a
  `Gated` duration, are not clickable, and are excluded from playback queues.
* **Content-node variability.** Audius resolves each stream to one of many community-run content
  nodes, and individual nodes go bad — at the time of writing one advertised node answers every
  request with `ERR_SSL_PACKET_LENGTH_TOO_LONG`. Because the API keeps routing a given track to the
  same node, the app fails over itself: artwork falls back through the `mirrors` origins Audius
  publishes, and a failed stream is replayed — same signed path, healthy node from Audius'
  `/health_check` node list — up to twice before the player reports an error. On a live 8-result
  search this moved playability from 2–5 of 8 to 8 of 8. Some tracks will still fail when every
  advertised node is unhealthy; the player says so and stays usable.
* **Console noise.** A failed cross-origin image or media load prints a browser-level
  `net::ERR_*` line that page JavaScript cannot suppress. These come from unhealthy Audius nodes,
  are recovered from by the failover above, and are not application errors.
* **Rate limits.** Without `VITE_AUDIUS_API_KEY`, Audius applies stricter limits. Search is debounced
  at 300 ms, discovery is cached for the session, and chart tiles fetch only when clicked.
* **Durations.** Row durations come from Audius metadata; the player shows the audio file's actual
  duration. They can differ by a second.
* **Mobile controls.** Below 560 px the reference design collapses the player to artwork + title +
  play. Previous/next/seek/volume have no mobile control surface by design; the queue panel (opened
  from the mobile menu) is the mobile route to track switching. See
  `docs/reference-deviations.md` D-23.
* **Browsers tested.** Chromium only, via Playwright, at 1440×900 and 390×844. Firefox and Safari are
  expected to work but were not tested here.
* **No persistence.** Volume and mute are remembered in `localStorage`. Nothing else is stored, and
  no data leaves the browser except Audius API calls and same-origin `/api/jamendo` calls.

---

## Design reference

The UI is a port of the design prototype in `refe/`, which is **read-only** and never imported at
runtime — the deployed app works with `refe/` deleted. The audit trail:

| Document | Contents |
|---|---|
| `docs/reference-audit.md` | Framework, routes, components, exact tokens, measured geometry, assets, what the prototype only mocks |
| `docs/reference-route-map.md` | Reference state machine → production routes |
| `docs/reference-component-map.md` | Every reference element → its production component |
| `docs/reference-deviations.md` | Every deviation, its cause, and residual pixel differences |
| `docs/reference-screenshots/` | The reference at four viewports, in every reachable state |

Fidelity was verified by measuring both applications at matching viewports. Every measured position,
size, colour, font size, weight and radius matches, with the documented exceptions. That is
**high-fidelity**, not pixel-perfect.

---

## Licence and attribution

Application code: MIT.

Music, artwork and metadata are provided by **third-party catalogues — Audius and Jamendo — and
belong to their respective rights holders.** This app streams provider content through each
provider's own public infrastructure and offers **no download, capture, offline caching or
re-hosting**. Catalogue availability differs between the two providers; neither is exhaustive.

### Jamendo

Jamendo's API terms require an application to credit the artist, credit Jamendo as the provider, and
link each item back to its own Jamendo page. This app does all three:

* the artist is credited wherever the track is rendered;
* Jamendo is credited as the source next to the artist on every Jamendo track;
* on **every** surface that renders an individual Jamendo track — search rows, queue rows, the top
  result, media cards and the now-playing cluster — that credit is a direct backlink to **that
  specific track's** Jamendo page (`shareurl`, falling back to `shorturl`), opened with
  `target="_blank" rel="noopener noreferrer"` and named `View "<track title>" on Jamendo`.

Making that true everywhere required one structural change: the reference draws a result row as a
single `<button>`, and an `<a>` may not be nested inside a `<button>`. The row is now a container
holding a stretched play button *and* the source link as siblings, so the row keeps its exact
geometry, click behaviour and keyboard operation while carrying the link the terms require. See
`docs/reference-deviations.md` D-26.

The only Jamendo track rendered without a link is one for which the provider returned neither
`shareurl` nor `shorturl` — there is then no page to point at, and the source is still credited.

In the player the backlink is carried by the credit text rather than by the icon link, precisely so
it survives the mobile mini-player, where the reference design hides that icon.

Each track's Creative Commons deed URL (`license_ccurl`) is retained on the track model. Jamendo
content remains subject to the licence attached to it by its rights holder; audio is never remixed,
transformed, cached offline or offered for download, and no ownership is claimed.

**Non-commercial caveat.** Jamendo's API terms describe free API use as being for **non-commercial**
purposes, and this implementation is built and documented as a non-commercial portfolio/student
project on that basis. If the project ever becomes monetised, ad-supported, subscription-based, or
part of a paid or commercial product, **do not assume the free API terms still apply**: review
Jamendo's current API terms and licensing — including their commercial licensing options — before
shipping it. Nothing in this README is legal advice or a guarantee of compliance; the terms of both
providers can change, and the current terms are what govern.

This application is not affiliated with, endorsed by, or sponsored by Audius or Jamendo. Their names
are used solely to credit the source of the content, as their terms require.
