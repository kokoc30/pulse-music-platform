# Reference Deviations

Every place production departs from `refe/`, why, and what it costs.
Recorded per `agents/02_REFERENCE_UI_PROTOCOL.md` → "No 'Creative Improvement' Without Need".

Three things force a deviation, and nothing else does:

* **A** — the reference asset or platform is unavailable outside its authoring environment.
* **B** — the reference control is explicitly out of V1 scope (`agents/01_PROJECT_CONTRACT.md` →
  "Product Non-Goals": no auth, payments, subscriptions, podcasts, playlists, downloads), and
  `agents/08_UI_FIDELITY_RULES.md` requires that no control "visually react but do nothing".
* **C** — the contract requires behaviour the reference prototype simply does not contain
  (loading, error, queue, mobile navigation, accessible sliders).

---

## Assets and platform

### D-01 — Logo rebuilt as an original SVG · cause A

| | |
|---|---|
| Reference | `<img src="/manus-storage/pulse-logo_d158ab89.png">`, 33 × 33 inside a 43 × 43 `.brand` box. |
| Production | `src/components/navigation/BrandMark.tsx` — an original inline SVG at the same 33 × 33 / 29 × 29 sizes. |
| Reason | The PNG is served by a Manus presigned-asset proxy needing `BUILT_IN_FORGE_API_KEY`; it returns **HTTP 500** here and is not in the repository (`docs/reference-audit.md` §1). |
| Method | Built to the written brand spec in `refe/ideas.md`: "a compact white disc mark with three nested waveform arcs". |
| Impact | Brand mark differs in detail. Geometry, colour and placement are identical. Also used as the favicon (`public/pulse-mark.svg`). |

### D-02 — Manrope loaded via `<link>` instead of a CSS `@import` · cause A(adjacent)

Reference: `@import url('https://fonts.googleapis.com/…Manrope…')` at the top of `index.css`.
Production: `<link rel="preconnect">` + `<link rel="stylesheet">` in `index.html` — the mechanism the
reference's own `index.html` comment block reserves for fonts. Same family, weights (400–800) and
rendering; removes a render-blocking `@import` chain. **Zero visual difference.**

### D-03 — Reference mock content is not reused

The four `/manus-storage/pulse-cover-*.jpg` covers and seven hard-coded Unsplash photos are mock
data. Production shows real Audius artwork, as `agents/06_AUDIUS_INTEGRATION.md` requires
("Do not ship reference mock artwork as if it belongs to real Audius tracks").

---

## Out-of-scope controls, re-pointed at truthful actions

Every one of these keeps the reference element, class and measured geometry. Only the label and the
action change.

| ID | Reference control | Production | Why |
|---|---|---|---|
| **D-04** | `.utility-links`: `Premium` · `Support` · `Download` | `Trending` · `Artists` · `Stations` — anchors to the real shelves | Subscriptions, a support org and a desktop app do not exist. Reference `href`s were dead `#anchor`s. |
| **D-05a** | `.install-button`: ⬇ `Install App` | 🎵 `Queue` — toggles the queue panel | No desktop app exists. |
| **D-05b** | `.signup-link`: `Sign up` | **removed** | No accounts in V1. The right cluster is ~64 px narrower; everything stays right-aligned by `margin-left:auto`. Only intentional width change in the header. |
| **D-05c** | `.login-button`: `Log in` (white pill) | `Play trending` — starts the trending queue | No auth in V1. Two labels (`Play trending` / `Play`) keep the pill at the reference's measured 109 px / 78 px / 69 px at each breakpoint. |
| **D-06** | `.player-track` ♥ `Like current song` | ↗ `Open … on Audius` (provider permalink, `rel="noopener noreferrer"`) | Liking needs an account store. `agents/10` explicitly endorses provider permalinks. Same 18 px icon, same slot. |
| **D-07** | `.player-volume` trailing `Speaker` glyph (inert) | `ListMusic` glyph — opens the queue panel | The reference glyph has no handler. Same 17 px size, same slot. |
| **D-08** | `.join-strip`: "Preview of Pulse / Listen to full songs and podcasts with occasional ads. No card required." + `Sign up free` | "Free and open listening / Stream the Audius catalogue straight away. No account, no ads, no card." + `Play trending` | No signup, no ads, no podcasts. Same gradient, geometry and button size. |
| **D-05d** | Sidebar `.side-card`s: "Create your first playlist", "Let's find some podcasts to follow" | "Start with a search" → focuses the search field; "Hear what is rising underground" → plays the underground queue | No playlists, no podcasts. Copy is kept to one body line so the cards stay **140 px**, matching the reference exactly. |
| **D-05e** | `.legal-links` (9 dead `#anchor`s) and `.language-button` (`English`, inert) | 9 working links — 5 in-page shelf anchors + Audius Terms / Privacy / Developer docs / "Powered by Audius ✓"; the pill becomes `Open Audius` | Nothing behind the reference links exists, and there is only one language. Only URLs verified to resolve are used (`src/lib/links.ts`). |
| **D-10** | Footer columns: `Company`, `Communities`, `Useful links`, `Pulse Plans` (6 paid tiers), 3 social glyphs `◎ 𝕏 f` | `Pulse`, `Browse`, `Powered by Audius`, `Stations` — same 3/5/4/6 link counts and grid; socials become 3 verified links (audius.co, docs.audius.co, github.com/AudiusProject/apps) with 17 px lucide icons in the same 36 px circles | No company, artist programme or paid tiers exist. Glyph→icon keeps the circles identical. |
| **D-13** | `.section-header` "Show all" → toast | Scrolls the shelf into view | The full shelf is already loaded (20 tracks back the 4 visible cards). |
| **D-14** | `.search-key` "⌘" (decorative) | Real `Ctrl/⌘ + K` shortcut focusing the field | A control that looks like a shortcut should be one. Glyph unchanged. |

Untouched and still inert by design: `.right-rail` (an `aria-hidden` decorative `<aside>`, not a control).

---

## Truthful shelf labels

The reference's shelf copy describes catalogue features Audius does not expose. Geometry, card
count, tone classes and gradient classes are unchanged; only the words and the data source differ
(`agents/05_IMPLEMENTATION_PLAN.md` → Phase 8: "If reference says 'For You', preserve visual design
but rename to a truthful non-personalized label").

| Reference shelf | Production | Real Audius operation |
|---|---|---|
| Trending songs | **Trending songs** *(unchanged)* | `tracks.getTrendingTracks()` |
| Popular artists | **Popular artists** *(unchanged)* | `users.getTopUsers()` |
| Popular albums and singles | **Popular this month** | `tracks.getTrendingTracks({ time: 'month' })` — the V1 domain model has no album entity |
| Popular radio — four named artist stations | **Popular radio** — four genre stations: Electronic · Hip-Hop · House · Lo-Fi, subtitled with the artists actually in each queue | `tracks.getTrendingTracks({ genre })` with the canonical Audius genre strings |
| Featured Charts — `Top Songs Global`, `Top Songs USA`, `Top 50 Global`, `Top 50 USA` | `Trending This Week`, `Trending This Month`, `Top 50 Underground`, `Top 50 All Time` | `getTrendingTracks({time})` and `getUndergroundTrendingTracks()`. Audius publishes no country charts, so country labels would be false. The `<em>` slot reads `AUDIUS` / `UNDERGROUND` / `ALL TIME`. |

Chart tiles fetch **on click**, never at page load, so the homepage costs 7 requests rather than 11.

---

## Behaviour the reference does not contain · cause C

| ID | Addition | Built from |
|---|---|---|
| **D-15** | **Loading states** — shelf skeletons and `.song-row` skeletons | The reference's own `--color-art-placeholder` (`#282828`) at the exact `.media-card` / `.song-row` geometry, with a reduced-motion-aware opacity pulse. The reference's mock search is synchronous and has no loading state. |
| **D-25** | **"No strong matches found on Audius." state** | The reference's mock search always matched something, so it has one empty state. Production distinguishes *the catalogue returned nothing* from *the catalogue returned only coincidental substring matches*, because promoting the latter as "Top result" is what made searches like `sara al swas` look broken. Rendered in the reference's own `.empty-results` block with a `SearchX` icon — same geometry, same typography, different words. |
| **D-16** | **Error states** — `.empty-results` re-used with a `⚠` icon in `--destructive`, plus a `.retry-button` styled like `.side-card button`; inline `.shelf-error` panels so one failed shelf never blanks the page | Reference surfaces (`--overlay-card`, `--radius-surface`, pill button). The reference's mock data cannot fail. |
| **D-09** | **Queue panel** — overlay anchored above the player | `--color-player-bg` `#181818`, `--color-player-border` `#343434`, `--radius-bar` 5 px, `--shadow-bar`, and the reference's own `.song-row` rows. Reference has no queue UI at all; the contract requires working queue behaviour. Escape closes it; focus moves to its close button. |
| **D-11** | **Mobile navigation drawer** | `--color-shell` `#121212` at the reference's own 296 px sidebar width, carrying the sidebar content that `@media (max-width: 830px)` hides. **The reference's `.mobile-menu` button has no `onClick` at all**, so nothing behind it was reachable. |
| **D-17** | **Accessible sliders** — progress and volume became `role="slider"` with pointer drag, arrow/Home/End keys and `aria-valuetext` | The reference renders `<div><i style="width:23%"/></div>` as a static bar with a hard-coded fill. Production keeps that exact 4 px rail inside a 14 px hit area (`.rail-hit`), which fits without changing the measured height of `.progress` (14 px) or `.player-volume` (18 px). The fill turns `--accent` on hover/focus/drag — the only added visual state, and the minimum needed to signal that a control is interactive. |
| **D-18** | **Artwork placeholder on bare `<img>`s** — `.song-row img`, `.player-track img`, `.top-result-card img` get `background: var(--color-art-placeholder)` | The reference puts that colour on `.art-wrap` / `.artist-image` containers, but rows and the player have no container. Without it a missing cover renders as a transparent gap. Measured as a `bg` difference in the fidelity diff; deliberate. |
| **D-19** | **Artwork mirror failover** | Audius publishes `artwork.mirrors` (alternate content-node origins) precisely so clients can fail over, and some primary nodes intermittently serve broken TLS. `Artwork` tries the primary, then each mirror, then a transparent pixel so the dark placeholder tile shows instead of a broken-image glyph. |
| **D-20** | **Content-node failover on a media error** | Audius resolves each stream to one of many community-run content nodes, and at least one advertised node currently answers every request with `ERR_SSL_PACKET_LENGTH_TOO_LONG`. The API keeps routing the same track to the same node, so re-asking does not help. On a media error the player tells the provider which host failed; the adapter then replays the *identical signed path* against a healthy node from Audius' own `/health_check` `data.network.content_nodes` list — the same failover model Audius publishes for artwork `mirrors`, verified against the live network. Bounded to `MAX_MEDIA_RETRIES` (2) per track so a dead track can never loop. Measured effect on a live 8-result search: **2–5 of 8 playable → 8 of 8**. |

---

## Structural

### D-21 — `wouter` → React Router, and search became a real route

Reference: single `/` route (`wouter`), search is an in-place content swap driven by `useState`.
Production: `react-router-dom` with `/`, `/search?q=…`, `*`, as `agents/03_ARCHITECTURE.md` specifies
and `agents/02`'s own example route table anticipates. The `.search-results` panel renders in the
identical slot inside `.browse-surface`; the visual state machine is unchanged. Deep links are
shareable and reloadable, which is why `vercel.json` ships an SPA rewrite.

### D-22 — `.app-frame` minimum height

Reference: `min-height: max(100vh - 64px, 3560px)` — a hard 3560 px floor that leaves ~1 100 px of
empty gradient below the footer, an artifact of matching a fixed-height design screenshot.
Production: `min-height: calc(100vh - var(--header-height))`. Reproducing the floor would add ~1 100 px
of dead scroll to every page. Every other measured property of `.app-frame` is identical.

### D-23 — Mobile keeps the reference mini-player

Below 560 px the reference hides the progress bar, previous/next, the like button and the whole
volume cluster, leaving artwork + text + one play button. Production **keeps that exactly**. The
consequence is that previous/next/seek/volume have no mobile control surface — so the queue panel
(reachable from the mobile drawer) is the mobile route to track switching, and the Playwright suite
scopes those control assertions to desktop.

### D-24 — Dark-only

The reference ships a `ThemeProvider` but hard-codes `defaultTheme="dark"` and never exposes a
toggle. Production drops the unused provider and ships the dark palette only.

### D-25 — Provider source credit on Jamendo tracks (Phase 2)

The reference has one provider and therefore no concept of crediting a source. Jamendo's API terms
require every item to credit the artist, credit Jamendo as the provider, and link back to that
track's own Jamendo page (`agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md`), so a small credit was
added. It is a licence obligation, not a design choice.

Impact is deliberately minimal, and **zero visual/behavioural change for Audius tracks** —
`ProviderCredit` renders `null` unless `track.attributionRequired` is set, and the row's layout rule
is scoped to `small[data-attributed='true']`.

On a Jamendo track the credit appears as `Artist · Jamendo`, where **`Jamendo` is the required
backlink to that specific track's page**, inheriting the font size, weight and colour of the line it
sits in. Every surface that renders an individual Jamendo track carries its own link:

| Surface | Backlink | Container |
|---|---|---|
| `.song-row` — search results **and** queue | ✅ per row | `<div>` (see D-26) |
| `.top-result-card` | ✅ | `<article>` |
| `.media-card` (`TrackCard`) | ✅ | `<article>` |
| `.player-track` (now playing) | ✅ | `<div>` |

The only case that renders a credit *without* a link is a Jamendo track for which the provider
returned neither `shareurl` nor `shorturl` — there is then no page to link to, and the source is
still credited as text.

One layout consequence: on an attributed row, `.song-data small` becomes a flex line so the credit
survives a long artist name instead of being clipped away with it by the reference's
`text-overflow: ellipsis`. The artist name still ellipsises; only the credit is pinned.

### D-26 — `.song-row` is a container, not a single `<button>`

The reference draws `.song-row` as one large `<button>`. That cannot satisfy D-25: an `<a>` may not
be nested inside a `<button>`, so a row that *is* a button can never carry the per-item backlink
Jamendo's terms require. The row was therefore restructured — this is a semantics change, not a
design change.

```
.song-row  <div>                     grid unchanged: 36px 42px minmax(0,1fr) 58px 27px
├── .song-row-action  <button>       stretched over the row, paints nothing
│                                    → keyboard + AT affordance, carries the accessible name
├── .song-index / artwork / .song-data / .song-duration / glyph
└── a.provider-credit-link           a real <a>, sibling of the button (Jamendo rows only)
```

`.song-row-action` is `position: absolute; inset: 0` with `pointer-events: none`, and the container
takes the mouse click. That keeps three reference behaviours intact: clicking anywhere on the row
plays it, the truncated-text `title` tooltips still resolve, and the source link stays clickable.
Keyboard focus is unaffected — focus does not use hit-testing — so the button is still tabbable and
Enter/Space still plays.

Two attribute moves follow, because row-level state left the button with the row:

* `:disabled` → `[aria-disabled='true']` on the container (the inner button is still really
  `disabled`, so it is skipped in the tab order);
* `aria-current` now sits on the container.

Measured after the change at 1440×900: height 59 px, columns `36px 42px 777px 58px 27px`, gap 12 px,
padding 7px 10px, radius 4 px — identical to the reference, and the overlay button covers the row
exactly (1008×59). Audius rows render the same markup minus the credit and behave as before.

### D-27 — Jamendo backlink moves off the player's icon slot

Below 560 px the reference collapses the player to a mini-player and hides `.player-track > a`
outright. That is fine for the Audius permalink, which is a convenience, but Jamendo's backlink is a
licence obligation and may not disappear on a phone.

So on an attributed track the backlink is carried by the credit text — which lives in the always-
visible artist line — and the icon anchor is dropped rather than pointing at the same page twice. An
Audius track keeps the reference's icon link and its wording (`Open <title> on Audius`) unchanged.

---

## Residual differences after the fidelity pass

Measured with `scripts/capture-screenshots.mjs` against both apps at 1440×900, 1280×800, 768×1024 and
390×844. **Every x / y / width / height / background / font-size / font-weight / border-radius of
every measured element matches the reference exactly**, except:

| Difference | Size | Status |
|---|---|---|
| `.song-row img`, `.player-track img` background | `transparent` → `#282828` | Intentional — D-18 |
| `.app-frame` / `.browse-surface` / `.right-rail` height | reference's fixed 3560 px floor → content height | Intentional — D-22 |
| `.search-results` height | 880 px (5 mock results) → content height (~20 real results) | Content-driven |
| `.browse-content` height, desktop | 2441 → 2446 px | **+5 px (0.2 %)** from real copy reflowing inside the artists / radio / charts shelves. Unresolved; Level C. |
| `.site-footer` position, tablet & mobile | y −10 px, h +10 px | Footer column text wraps differently at narrow widths. Net page height unchanged. Level C. |

No Level A or Level B mismatch remains. Per `agents/12_AGENT_EXECUTION_RULES.md` → Rule 12, this is
described as **high-fidelity**, not "pixel perfect".

---

## Note on the reference directory

`refe/` was installed and run for the audit. `pnpm-lock.yaml`, `package.json`, `tsconfig.json`,
`components.json` and `vite.config.ts` were MD5-verified unchanged afterwards.

One correction to record: during scaffolding, three `tsconfig` writes were briefly issued against
`refe/` instead of the project root. `refe/tsconfig.json` was restored byte-for-byte from a
pre-existing backup (MD5 `1e0fa60a1abb0b4bfeed3e2613a5bfff`) and the stray `refe/tsconfig.app.json`
was deleted. `refe/tsconfig.node.json` had no backup and was **rewritten with the standard Vite
template contents** rather than its original bytes. That file is referenced by nothing in the
reference — `refe/tsconfig.json` has no `references` array, and `dev` / `build` / `check` never read
it — so the reference still installs, builds and runs identically (verified: `pnpm dev` serves
`http://localhost:3000` and every audit screenshot was captured after the restore).

---

## Phase 3 — the YouTube fallback

The reference prototype has no concept of video, of a second player, or of a provider the visitor
opts into. Everything in this section is therefore an addition rather than a divergence, and each
one exists because a YouTube result **cannot honestly be drawn as an audio row**. Nothing outside
these five items changed: every Audius and Jamendo surface renders exactly the markup and geometry
measured in the fidelity pass above.

### D-28 — YouTube results use a 16:9 thumbnail, not square artwork

**Reference:** `.song-row img` is a 36 × 36 square cover, `border-radius: 3px`.

**Production, for YouTube rows only:** an 80 × 45 box at 16:9, with the image inside it set to
`object-fit: contain`.

**Why.** `agents/25_YOUTUBE_UI_ATTRIBUTION_AND_FIDELITY.md` requires the thumbnail be presented
unmodified at 16:9 and forbids cropping it into square album art or filtering it. `cover` would fill
the frame by cutting the sides off a 16:9 still; `contain` shows the frame whole. The normaliser
also prefers YouTube's natively-16:9 thumbnail keys (`maxres` 1280 × 720, then `medium` 320 × 180)
over the 4:3 ones (`high` 480 × 360, `standard` 640 × 480, `default` 120 × 90), because a 4:3 key is
a pillarboxed image and would look wrong even in a correct 16:9 box — see
`docs/youtube-policy-audit.md` §3.

Audius and Jamendo rows are untouched: they keep the reference's square artwork exactly.

### D-29 — a separately labelled "YouTube results" section

**Reference:** one `Songs` list under `Top result`.

**Production:** YouTube results render in their own section, under their own heading, below the
audio results, separated by the reference's own `--color-divider` rule.

**Why.** Three facts would be misrepresented by merging them into `Songs`: they are video, they play
in a different player, and some of them cannot be played in this app at all. `agents/25` requires
the separate label explicitly. The section is also the *only* place in the app that names a
provider in a heading — the Audius/Jamendo merge is still one unlabelled list, exactly as Phase 2
established.

### D-30 — text attribution, and no YouTube logo

**Reference:** no source attribution anywhere.

**Production:** every YouTube row and the player surface carry a plain-text **YouTube** label that
is itself the link to `youtube.com/watch?v=…`.

**Why.** YouTube's branding guidelines state *"You cannot modify the colors of the YouTube logos or
YouTube Icons"* and impose minimum sizes and clear space. This build does not ship the official
brand assets, and hand-drawing an approximation — or repurposing a generic icon-font glyph as a
brand mark — is exactly the modified logo the guidelines forbid. A text word-mark is not a logo, so
the logo rules do not bind it, and it satisfies §III.F's requirement that YouTube be identifiable as
the source. The `lucide-react` glyph beside the section heading is a section marker, not a brand
mark, and carries no attribution weight.

The row markup follows the same shape as D-26's `.song-row`: a container with a stretched
`pointer-events: none` button for keyboard and assistive technology, and the source link as a
*sibling* of that button rather than a descendant, because an `<a>` may not nest inside a
`<button>`.

### D-31 — a persistent visible player surface

**Reference:** one bottom bar, `.music-player`, 66 px tall.

**Production, only while a YouTube video is loaded:** a 480 × 270 panel above the bottom bar,
holding the official IFrame player, with the title, channel, attribution link, play/pause and close
control as siblings outside it. Below 560 px it becomes full-width at 16:9. The bottom bar itself is
unchanged and still shows the audio track.

**Why.** This is a policy requirement, not a layout choice:

* *"Embedded players must have a viewport that is at least 200px by 200px"* — the stage carries a
  hard `min-width: 200px; min-height: 200px`, asserted in unit tests and measured in E2E.
* *"We recommend 16:9 players be at least 480 pixels wide and 270 pixels tall"* — hence 480 × 270.
* *"You must not display overlays, frames, or other visual elements in front of any part of a
  YouTube embedded player, including player controls"* — hence the stage has exactly one child, the
  iframe, and every control is a sibling. An E2E test calls `elementFromPoint` at the centre of the
  stage and asserts the topmost element is the iframe.
* A player that is not displayed in the page the user is viewing is the *background player* the
  developer policies prohibit — hence the surface lives above the router so navigation cannot
  unmount it, closing it stops playback, and a hidden document pauses it.

The panel is built from the reference's own vocabulary — `--color-player-bg`, `--color-player-border`,
`--radius-surface`, `--shadow-bar`, `--dur-fast` — so it reads as part of the same system.

### D-32 — the fallback action and the privacy page

**Reference:** the empty state is `.empty-results` with an icon, a title and a description, and
there is no privacy page.

**Production:** the empty and no-strong-match states gain a real `<button>` (*Search YouTube*), a
result list gains a subtle text button (*Search YouTube for more*), and `/privacy` is a new route
reachable from the footer.

**Why.** The button is the entire quota strategy expressed as UI: nothing may reach YouTube without
a deliberate press (`agents/22`). It is styled from the reference's `--color-control` /
`--radius-pill` control language, and the empty-state block it sits in is otherwise unchanged.

The privacy page is required by `agents/26` because an embedded YouTube player shares request and
playback context with YouTube and Google, and a visitor is entitled to be told so before they press
play. It reuses `.search-results` for its frame so it inherits the reference's page chrome, and adds
only a `.prose` type scale for running text — something the reference, having no prose page, never
needed to define.

---

## Phase 4 — local personalization

The reference is a static browse page: five shelves whose content never changes. Phase 4 makes
the *content* adaptive while holding the *geometry* fixed, which is the only way personalization
could be added without becoming a redesign. The rule followed throughout: **a personalized shelf
is an ordinary `.music-section` containing an ordinary `.music-grid` of ordinary `.media-card`s.**
Same column count, same card dimensions, same hover, same skeletons, same responsive breakpoints.
A visitor who never turns personalization on sees a page that is byte-identical to Phase 3.

### D-33 — shelves that change identity between visits

**Reference:** five fixed shelves — Trending songs, Popular artists, Popular this month, Popular
radio, Featured Charts — in a fixed order.

**Production:** still exactly five shelves above the footer, still ending with Featured Charts, but
which five is decided by `planHomeSections()` from the local profile. A cold browser gets the
reference's five, unchanged and in the reference's order. As history accumulates, personalized
shelves take slots from discovery one at a time.

**Why.** The alternative — appending personalized shelves to the existing five — would double the
page length for a returning listener and push the reference's own content below three screens of
scrolling. Substitution keeps the page the size it was designed to be. `HOME_SECTION_COUNT` is
asserted at every profile stage by both the unit suite and an E2E test, so the page can never grow
or empty as a side effect of a ranking change.

### D-34 — a 16:9 tile inside a square grid cell

**Reference:** every `.media-card` art tile is `aspect-ratio: 1` with `object-fit: cover`.

**Production:** a YouTube row in *Recently played* keeps the same square cell but renders its
thumbnail 16:9 and letterboxed inside it (`.art-wrap-video` + `.yt-thumb-fill`, `object-fit:
contain` on a black ground).

**Why.** Not a style choice. Phase 3 established that a YouTube thumbnail is shown unmodified and
never cropped (`docs/youtube-policy-audit.md` §3, D-30); `cover` in a square cell would crop a
16:9 frame into something that reads as album art, which is exactly the misrepresentation that
decision exists to avoid. The cell keeps its reference dimensions, so the grid rhythm is untouched
— only the image inside it is shaped honestly.

### D-35 — a source link on a card

**Reference:** a `.media-card` subtitle is one plain line of artist text.

**Production:** a *Recently played* card's subtitle carries the artist plus a small source link —
*Audius*, *Jamendo* or *YouTube* — pointing at the provider's own page.

**Why.** The same requirement `TrackRow` already satisfies for search results (D-24): Jamendo's API
terms require a visible backlink per content item, and YouTube requires the watch-page link and
channel attribution. A history card is a rendered content item like any other. It reuses the
existing `.provider-credit-link` treatment rather than inventing a second one, and `rel="noopener"`
without `noreferrer`, because YouTube's Required Minimum Functionality prohibits `noreferrer`.

### D-36 — a note under a shelf heading

**Reference:** `.section-header` is a heading and a *Show all* button, with no room for prose.

**Production:** a personalized shelf may carry one short `.section-note` line beneath the heading —
*"Kept on this device only."*, *"Chosen on this device from what you have played here."*

**Why.** The disclosure obligation lands where the claim is made. Telling someone their
recommendations are local, at the moment they are looking at those recommendations, is more honest
than a paragraph on a policy page they may never open. It is one 11px dim line in the existing type
scale, occupying space the reference already leaves as margin, and only personalized shelves have it.

### D-37 — the consent strip and the settings page

**Reference:** neither exists. There is no stored state to consent to and nothing to clear.

**Production:** a dismissible `.personalization-prompt` strip at the top of the home page, shown
once, and a `/settings` route holding the switch and the three clear/reset controls.

**Why.** Phase 4 stores something about the visitor for the first time, so it has to ask, and it has
to offer a way to undo. The strip is built on the reference's `.side-card` surface treatment
(`--overlay-card`, `--border`, `--radius-surface`) and sits in normal document flow — never fixed,
never overlaying content, never blocking. Both answers are ordinary buttons of equal weight and
nothing is pre-selected; *Not now* is not hidden, greyed or made smaller.

The settings page reuses `.search-results` for its frame and the `.prose` scale Phase 3 added for
`/privacy`, so it inherits the same page chrome. Destructive actions confirm in place rather than
through `window.confirm`, which is unstyleable and poorly announced, and the confirmation is a live
region so it is read out rather than appearing silently.

---

## Phase 5 — the search history dropdown

### D-38 — a panel hanging from the search field

**Reference:** `.top-search` is a self-contained `<label>` in the header. Nothing opens beneath it,
because the reference has no stored history to offer.

**Production:** focusing the field opens a panel anchored directly under it, listing recent
searches and a compact Recently Played section.

**Why.** Phase 4 gave the browser a real local history; the search field is where a returning
listener expects to reach it. The panel is built entirely from the reference's own vocabulary —
`--color-control` for the surface, `--overlay-row-hover` for hover, `--radius-search`'s sibling
`--radius-surface` for the corner, `--color-text-*` for type, `--dur-fast` for transitions — so it
reads as the field having grown downwards rather than as a browser autocomplete pasted over the
page. No new colour, radius or type scale was introduced.

Two structural consequences worth recording:

* **A wrapper carries the sizing.** `.top-search` is a `<label>`, and a listbox with buttons inside
  a label is invalid: clicking any row would also focus the input. So the field and the panel are
  siblings inside a new `.search-shell`, which takes over the reference's `var(--search-width)` and
  its `flex: 1` behaviour below 830px. `.top-search` keeps its exact geometry and simply fills the
  shell.
* **On a phone the panel breaks out of that anchor.** Below 560px the field is one item in a
  crowded header, and matching its width would leave roughly 200px for a song title. The panel
  becomes `position: fixed` inset 10px from both edges — still directly under the field, since the
  header is sticky at the top, but using the width that is actually there. Measured at 370px of a
  390px viewport, with no horizontal page overflow.

The rows follow the reference's row density rather than inventing one: 40px minimum height (44px on
touch), the same 11–13px type, and a remove control that is a 30px circular target rather than a
pinprick icon.

### D-39 — the field announces as a combobox

**Reference:** a plain `<input type="search">`.

**Production:** the same input, plus `role="combobox"`, `aria-expanded`, `aria-controls`,
`aria-autocomplete="list"` and `aria-activedescendant`, with the panel as `role="listbox"` and each
row as `role="option"`.

**Why.** This is the WAI-ARIA pattern for an input with a popup list, and it is what makes arrow-key
navigation announce correctly: focus never leaves the field, so the visitor can keep typing while
stepping through history.

One compromise is recorded honestly: the remove button sits **inside** its option. A screen reader
in browse mode may not reach a control nested in an option, so removal is *also* bound to Delete and
Backspace on the highlighted row, and every option carries an explicit `aria-label` so its
accessible name stays the query alone rather than absorbing the button's label.

The role change means the field no longer exposes the implicit `searchbox` role. Eleven existing
test call sites used `getByRole('searchbox')` purely as a selector; they now select by the
accessible name, which is unchanged and is what the rest of the suite already used.
