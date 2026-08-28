# Reference Audit — `refe/`

Audit performed before any production UI work, per `agents/02_REFERENCE_UI_PROTOCOL.md`.
The reference was **read, installed, executed and screenshotted**. No tracked reference file was modified
(`pnpm-lock.yaml`, `package.json`, `tsconfig.json` MD5s verified identical before and after `pnpm install`).

---

## 1. Framework / runtime (verified from files, not filenames)

| Aspect | Finding | Evidence |
|---|---|---|
| Project name | `pulse-music-home` v1.0.0 | `refe/package.json` |
| Package manager | pnpm `10.4.1` (`packageManager` field), `pnpm-lock.yaml` present | `refe/package.json` |
| Framework | React `19.2.1` + React DOM `19.2.1` | `refe/package.json` |
| Language | TypeScript `5.6.3`, `strict: true`, `moduleResolution: bundler` | `refe/tsconfig.json` |
| Build tool | Vite `7.1.9` (`root: client/`, out `dist/public`) | `refe/vite.config.ts` |
| Router | **`wouter` 3.3.5** (patched — `patches/wouter@3.7.1.patch`) | `refe/client/src/App.tsx` |
| Styling | **Tailwind CSS v4** via `@tailwindcss/vite` + a large hand-authored semantic-class stylesheet | `refe/client/src/index.css` |
| Component library | shadcn/ui (new-york, neutral base) + Radix primitives — **present but not used by the music design** | `refe/components.json`, `client/src/components/ui/*` |
| Animation | `framer-motion` installed but **unused** in the design; all motion is CSS keyframes/transitions | grep of `client/src/pages/Home.tsx` |
| Icons | **`lucide-react` 0.453.0** — the only icon source | `client/src/pages/Home.tsx` imports |
| Font | **Manrope** 400/500/600/700/800, Google Fonts `@import` at top of `index.css` | `client/src/index.css:5` |
| Server | Trivial Express static-file server for the built SPA. No API, no DB, no auth logic. | `refe/server/index.ts` |
| Runtime extras | Manus platform plugins: debug-log collector, `/manus-storage` presigned-asset proxy, `vite-plugin-manus-runtime` | `refe/vite.config.ts` |

### How it runs

```powershell
cd C:\music-platform\refe
pnpm install --frozen-lockfile   # 9.7s, lockfile unchanged
pnpm dev                         # vite --host, http://localhost:3000
```

Confirmed working: Vite 7.1.9 ready in 882 ms on port 3000.

### Blocking limitation discovered while running the reference

`refe/vite.config.ts` serves `/manus-storage/*` through a **presigned-URL proxy** that requires
`BUILT_IN_FORGE_API_URL` and `BUILT_IN_FORGE_API_KEY`. Those secrets are not present in this environment, so
**five reference assets return HTTP 500 and never render**:

```
/manus-storage/pulse-logo_d158ab89.png
/manus-storage/pulse-cover-jolene_4720d406.jpg
/manus-storage/pulse-cover-night-rider_904eabf0.jpg
/manus-storage/pulse-cover-rain-sounds_528fad95.jpg
/manus-storage/pulse-cover-studio_6ad3adac.jpg
```

`client/public/` contains only `.gitkeep` and the `__manus__` debug files — the artwork/logo binaries are
**not in the repository at all**. The Unsplash-hosted images (artists, garden, chart photos) do load.

Consequences, recorded per the "Stop Conditions" rule in `agents/AGENTS.md`:

* Four mock cover JPEGs are unrecoverable — irrelevant, because production replaces all mock artwork with
  real Audius artwork by contract (`agents/06_AUDIUS_INTEGRATION.md`).
* **The Pulse logo PNG is unrecoverable.** It is reproduced in production as an original SVG built to the
  written specification in `refe/ideas.md` ("a compact white disc mark with three nested waveform arcs").
  See `docs/reference-deviations.md` → D-01.

Other reference console noise (not production-relevant): `GET /%VITE_ANALYTICS_ENDPOINT%/umami → 404`
(unsubstituted Umami analytics placeholder in `client/index.html`).

---

## 2. Routes / views

The reference is a **single-route application**. Search is an in-place content swap, not a route.

| Reference route / state | Purpose | Production route / state | Fidelity status |
|---|---|---|---|
| `/` (wouter `<Route path="/" component={Home}/>`) | Home / browse — 5 shelves + footer | `/` | matched |
| `/` with `query.trim() !== ""` | `.search-results` panel replaces `.browse-content` inside `.browse-surface` | **`/search?q=…`** (React Router) — identical panel in the identical slot | matched, route added |
| `.empty-results` (no matches) | No-results state | same markup on `/search` | matched |
| `.music-player` (a track is selected) | Persistent bottom player | same, now globally persistent | matched |
| `.join-strip` (no track selected) | Bottom acquisition banner | same, truthful copy | matched, copy changed |
| `.notice` toast | Transient message | same, real playback feedback | matched |
| `/404` + catch-all `<NotFound/>` | Not found | `*` → `NotFound` | matched |
| — (does not exist) | Loading state | added (reference-styled skeletons) | addition |
| — (does not exist) | Provider error state | added (reference `.empty-results` geometry) | addition |
| — (does not exist) | Queue panel | added (reference surface language) | addition |
| — (does not exist) | Mobile navigation drawer | added — reference's `.mobile-menu` button has **no handler** | addition |

See `docs/reference-route-map.md` for the full map.

---

## 3. Components

All of the music design lives in **one 237-line file**, `refe/client/src/pages/Home.tsx`, with two tiny local
helpers (`PlayAction`, `SectionHeader`). Nothing from `components/ui/` is used. Production decomposes this into
the component boundaries required by `agents/04_TARGET_FILE_STRUCTURE.md`; the mapping is in
`docs/reference-component-map.md`.

Inventory of the design surfaces present in the reference:

* **Header** `.site-header` — mobile menu button, brand, home button, search field, 3 utility links, rule, install button, sign-up link, log-in pill
* **Sidebar** `.shell-sidebar` — "Your Library" heading + add button, two `.side-card`s, legal link cloud, language pill
* **Browse** `.browse-surface` → `.browse-content` — 5 × `.music-section`
* **Cards** `.media-card` (square art + play FAB), `.artist-card` (circular portrait), `.station-card` (`.station-cover` tinted tile), `.chart-card` (`.chart-cover` gradient tile)
* **Search** `.search-results` — title row, `.top-result-card`, `.song-list` of `.song-row`, `.equalizer` now-playing indicator, `.empty-results`
* **Player** `.music-player` — `.player-track`, `.player-controls` (prev / `.round-play` / next + `.progress`), `.player-volume`
* **Banner** `.join-strip`
* **Toast** `.notice`
* **Right rail** `.right-rail` (decorative, `aria-hidden`, 40 px, wide screens only)
* No skeletons, no error state, no queue panel, no modals/sheets, no mobile nav — these do not exist in the reference.

---

## 4. Design tokens (exact values, transcribed from `refe/client/src/index.css`)

### Colour

| Token | Value | Used for |
|---|---|---|
| `--background` | `#000` | page / header frame |
| `--foreground` | `#f5f5f5` | body text (`body` uses `#f4f4f4`) |
| `--card` / `--popover` | `#202020` | shadcn surface (unused by design) |
| `--primary` | `#fff` | primary buttons |
| `--primary-foreground` | `#111` | text on primary |
| `--secondary` | `#292929` | footer dividers, social buttons |
| `--muted` | `#242424` | search field, home button, side-cards |
| `--muted-foreground` | `#b3b3b3` | secondary text |
| `--accent` / `--ring` | `#b64be7` (Pulse Orchid) | focus rings, equalizer bars, play-FAB hover |
| `--destructive` | `#ff5858` | errors |
| `--border` | `rgba(255,255,255,.1)` | hairlines |
| `--input` | `rgba(255,255,255,.13)` | inputs |
| Sidebar / rail surface | `#121212` | `.shell-sidebar`, `.right-rail` |
| Browse surface | `linear-gradient(180deg,#242424 0,#121212 190px,#121212 100%)` | `.browse-surface` |
| Search surface | `linear-gradient(180deg,#2a2032 0,#121212 240px)` | `.search-results` |
| Player surface | `#181818`, top border `#343434` | `.music-player` |
| Art placeholder | `#282828` | `.art-wrap`, `.artist-image` |
| Row hover | `rgba(255,255,255,.08)` | `.song-row:hover` |
| Card surface | `rgba(255,255,255,.06)` → hover `.1` | `.top-result-card` |
| Tertiary text | `#a7a7a7` | card subtitles, footer links |
| Legal text | `#a7a7a7` @ 9px | `.legal-links` |
| Banner gradient | `linear-gradient(100deg,#a51ea5 0%,#b64be7 40%,#4c9cf1 100%)` | `.join-strip` |
| Station tints | `.lavender #aaa6fa` · `.pink`/`.rose` `#ed8fc7` · `.amber #dbc875` (all `opacity:.89`) | `.station-cover::before` |
| Chart gradients | `.global linear-gradient(135deg,#9a4aba,#563288)` · `.usa #f12635` · `.top50 linear-gradient(180deg,#238c89,#283e75)` · `.top50usa linear-gradient(125deg,#d61683,#f5232a 63%,#202020)` | `.chart-cover` |
| Progress rail / fill | `#535353` / `#fff` | `.progress > div` / `i` |
| Eyebrow text | `#cbb8d7` | `.eyebrow`, `.track-kicker` |

### Geometry (measured live at 1440×900)

| Element | Measured |
|---|---|
| `.site-header` | 1440 × **64** px, `padding 8px 22px`, sticky, `z-index 40` |
| `.brand` | 43 × 43 at x=22, logo image 33 × 33 |
| `.home-button` | 48 × 48 circle at x=77, bg `#242424` |
| `.top-search` | **357** × **48** at x=137, radius **25px**, `min(357px, 29vw)` |
| `.login-button` | 109 × 48 pill at x=1309 |
| `.app-frame` | `grid-template-columns: 296px minmax(0,1fr) 40px`, `padding 0 8px` |
| `.shell-sidebar` | **296** × 754 at x=8, radius **7px**, sticky `top:64px`, `height: calc(100vh - 146px)`, `min-height:595px` |
| `.browse-surface` | starts at **x=304**, width 1088, radius 7px |
| `.right-rail` | 40 px at x=1392 |
| `.browse-content` | `padding 24px 24px 115px` → content x=328 |
| `.music-grid` | `repeat(4, minmax(0,1fr))`, `gap 24px` → card 242 px, art 242 × 242 |
| `.media-card h3` | 13 px / 600 / `letter-spacing -.25px`, single-line ellipsis |
| `.media-card p` | 11 px / 500, 2-line clamp, `#a7a7a7` |
| `.section-header h2` | `clamp(21px, 2.05vw, 26px)` / 800 / `letter-spacing -1.05px` |
| `.side-card` | 278 × 140 at x=17, `margin 0 9px 11px`, `padding 20px`, radius 7px |
| `.music-player` / `.join-strip` | fixed `right/bottom/left: 8px`, **min-height 66 px** (measured 68/67), radius 5px, `z-index 50` |
| `.music-player` grid | `minmax(180px,1fr) minmax(320px,1.5fr) minmax(150px,1fr)`, `gap 24px`, `padding 8px 21px` |
| `.player-track img` | 48 × 48, radius 3px |
| `.round-play` | 32 × 32 white circle |
| `.progress` | `grid 30px minmax(0,1fr) 30px`, gap 8px, 9 px text; rail 4 px, radius 8px |
| `.player-volume > div` | 90 px rail |
| `.top-result-card` | `min(400px,100%)` × 124, `grid 92px 1fr`, gap 16, padding 16, radius 7px; art 92 × 92 radius 4 |
| `.song-row` | `grid 36px 42px minmax(0,1fr) 58px 27px`, gap 12, **min-height 59 px**, radius 4px; art 42 × 42 radius 3 |
| `.search-results` | `padding 45px 40px 130px`, `min-height 880px` |
| `.result-title-row h1` | `clamp(27px,4vw,46px)` / `letter-spacing -2px` |
| `.pulse-app` | `padding-bottom: 82px` (78 px ≤560) to clear the fixed bottom bar |

### Radii / shadow / motion / z-index

* Radii: `--radius .55rem`; app surfaces `7px`; player/banner `5px`; chart cover `5px`; station cover `6px`; song row `4px`; player + top-result art `3px`/`4px`; pills `999px`; search `25px`.
* Shadows: `.card-play 0 7px 18px rgba(0,0,0,.34)`; `.music-player/.join-strip 0 4px 24px rgba(0,0,0,.32)`; `.notice 0 8px 30px rgba(0,0,0,.3)`.
* Motion: **160 ms** for hover/press/opacity, **180 ms `cubic-bezier(.23,1,.32,1)`** for artwork scale, **300 ms** shelf entry with **40 ms** stagger (children 2/3/4 → 0.04/0.08/0.12 s), `.equalizer` 700 ms alternate, `.notice` 180 ms pop. Press state `scale(.97)`, hover lift `scale(1.035)`/`1.045`/`1.06`/`1.08`.
* z-index: header `40`, sidebar `12`, player/banner `50`, notice `70`.
* Focus: `outline: 2px solid #b64be7; outline-offset: 3px` on `button/a/input:focus-visible`.
* Reduced motion: shelf-entry animation is inside `@media (prefers-reduced-motion: no-preference)`.

### Breakpoints (empirically confirmed at 1440 / 1280 / 768 / 390)

| Breakpoint | Behaviour |
|---|---|
| **> 1050 px** | 3-column frame `296px / 1fr / 40px`; full utility nav |
| **≤ 1050 px** | frame → `255px / 1fr`; right rail hidden; grid gap 24→17; utility links 13→11 px; browse padding 24→20 |
| **≤ 830 px** | header padding 22→13; **mobile menu appears**; home button, utility links, rule, install, sign-up **hidden**; search flexes to fill; login pill 109×48→78×40; **sidebar hidden**, frame → 1 column, padding 0; shelves become horizontally scrollable `repeat(4, minmax(135px,1fr))`; footer → 3 columns; player → 2 columns; **`.player-volume` hidden** |
| **≤ 560 px** | header 64→58; search 48→40, `⌘` key hidden; login pill 69×38; browse padding 16; section h2 20 px; shelves `repeat(4,132px)` gap 14; footer 2 columns; banner and player become **edge-to-edge, radius 0, min-height 76 px**; **progress bar + prev/next + like hidden → mini-player** (art 47 px + text + play button); search-results padding 16 |

---

## 5. Assets

| Asset | Location | Status |
|---|---|---|
| Pulse logo PNG | `/manus-storage/pulse-logo_d158ab89.png` | **missing** (proxy 500) → reproduced as original SVG, see D-01 |
| 4 mock cover JPEGs | `/manus-storage/pulse-cover-*.jpg` | **missing** (proxy 500) → not needed; real Audius artwork replaces them |
| 7 Unsplash photos | remote `images.unsplash.com` URLs hard-coded in `Home.tsx` | load fine, but they are **mock content** — not reused in production |
| Icons | `lucide-react` (`Play`, `Pause`, `SkipBack`, `SkipForward`, `Volume2`, `Speaker`, `Heart`, `Search`, `Menu`, `Home`, `CirclePlus`, `Globe2`, `ArrowDownToLine`, `MoreHorizontal`, `ChevronLeft`, `ChevronRight`, `X`) | reused verbatim in production |
| Font | Manrope, Google Fonts | reused in production (via `<link>` instead of CSS `@import`, see D-02) |
| Local font files | none | n/a |
| Favicon | the missing logo PNG | replaced by the production SVG |

No asset is copied from `refe/` into production, because every reusable asset is either remote (Manrope,
lucide) or missing. Production imports **nothing** from `refe/` at runtime.

---

## 6. Behaviour the reference only mocks

| Reference behaviour | Reality in `refe/` |
|---|---|
| Search | `Array.filter()` over 8 hard-coded objects (`Home.tsx:113-118`) |
| Discovery shelves | 5 hard-coded arrays (`trending`, `albums`, `artists`, `radio`, `charts`) |
| Playback | `setCurrentTrack` + `setIsPlaying` only — **no `<audio>` element exists anywhere in the project** |
| Progress bar | hard-coded `width: 23%` and the literal string `0:42` |
| Volume bar | hard-coded `width: 64%`, not interactive |
| Prev / next | buttons with no `onClick` |
| Like, Install, Sign up, Log in, Show all, Create playlist, Browse podcasts, artist portraits, charts | all call `showNotice(...)` — a toast that says the feature is coming |
| Mobile menu button | **no handler at all** |
| Language button, right rail, footer/legal links | inert (`href="#anchor"`) |

Everything in the "Reality" column is replaced by real behaviour in production, per
`agents/05_IMPLEMENTATION_PLAN.md`. Where a mocked control is out of V1 scope (auth, payments, podcasts,
playlists, downloads), it is re-pointed at a truthful action of identical geometry rather than deleted —
each such change is logged in `docs/reference-deviations.md`.

---

## 7. Screenshots

`docs/reference-screenshots/` — captured with `scripts/capture-screenshots.mjs` against the running reference
at 1440×900, 1280×800, 768×1024 and 390×844:

`home-{desktop,laptop,tablet,mobile}.png` (+ `-full`), `search-*`, `search-empty-*`, `playing-*` — 20 files.
