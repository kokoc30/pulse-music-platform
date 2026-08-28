# YouTube policy audit — Phase 3

**Audited:** 2026-08-27. **Method:** each conclusion below was read from the live official Google /
YouTube documentation page cited beside it on that date. No secondary source, blog, forum answer or
model recollection was used for any policy conclusion, per
`agents/20_YOUTUBE_PHASE3_ENTRYPOINT.md` → "Official Sources To Re-Verify".

Where a claim in the Phase 3 agent pack was confirmed it is marked **CONFIRMED**. Where the live
documentation says something the pack did not, it is marked **NEW**. Current official documentation
outranks the pack.

---

## 1. `search.list` quota

**Source:** <https://developers.google.com/youtube/v3/determine_quota_cost>,
<https://developers.google.com/youtube/v3/docs/search/list>

> "Projects that enable the YouTube Data API receive a default quota allocation of 100 `search.list`
> calls, 100 `videos.insert` calls, and 10,000 units per day combined for all other endpoints."

> "The `search.list` and `videos.insert` methods have their own quota buckets. Each of these methods
> has a default daily limit of 100 per day."

> `search.list`: "A call to this method has a quota cost of 1 unit in the Search Queries quota
> bucket."

**CONFIRMED.** The pack's constraint holds: **100 search calls per project per day** by default.
`videos.list` costs **1 unit** and is billed to the separate 10,000-unit/day general pool
(<https://developers.google.com/youtube/v3/docs/videos/list>).

### Consequence for this app

100 searches/day is roughly **four searches an hour** for the *entire deployment*, shared by every
visitor. It cannot be spent on a debounced type-ahead — a single visitor typing one word would burn
several days of allocation. This is the whole reason YouTube sits behind an explicit button.

**Implemented budget:** one deliberate fallback click ⇒ exactly **1 `search.list` + 1 `videos.list`**
⇒ **1 search-bucket unit + 1 general-pool unit**. Never more. No autocomplete, no alias fan-out, no
pagination, no prefetch, no retry loop.

---

## 2. `search.list` parameters

**Source:** <https://developers.google.com/youtube/v3/docs/search/list>

| Parameter | Documented wording | Used |
|---|---|---|
| `part` | required; "Set the parameter value to `snippet`." | `snippet` |
| `type` | "comma-separated list of resource types … default `video,channel,playlist`" | `video` |
| `q` | "specifies the query term to search for" | literal, un-normalised user text |
| `maxResults` | "Acceptable values are 0 to 50, inclusive. The default value is 5." | fixed `8` |
| `order` | acceptable values `date, rating, relevance, title, videoCount, viewCount`; `relevance` is the default | `relevance` |
| `videoEmbeddable` | "`any` … `true` – Only retrieve embeddable videos." **Requires `type=video`** | `true` |
| `videoSyndicated` | "`any` … `true` – Only retrieve syndicated videos." **Requires `type=video`** | `true` |
| `safeSearch` | `moderate` (default), `none`, `strict` | `moderate` |
| `videoCategoryId` | string. **Requires `type=video`** | `10` (Music) |
| `relevanceLanguage` | "typically an ISO 639-1 two-letter language code" | only on a high-confidence script signal (see §7) |

**CONFIRMED.** Every filter named in `agents/22` is a live, documented parameter, and all three
`video*`-prefixed filters are legal because the request always sets `type=video`. `videoCategoryId=10`
is still the documented mechanism for restricting a video search to Music — no replacement
music/topic mechanism has superseded it — so it is used as written rather than guessed at.

---

## 3. Batched enrichment: `videos.list`

**Source:** <https://developers.google.com/youtube/v3/docs/videos/list>,
<https://developers.google.com/youtube/v3/docs/videos>

> "The `id` parameter specifies a comma-separated list of the YouTube video ID(s) for the resource(s)
> that are being retrieved."

> "A call to this method has a quota cost of 1 unit."

Properties relied on, quoted from the Video resource reference:

* `contentDetails.duration` — "The length of the video. The property value is an ISO 8601 duration."
* `status.embeddable` — "This value indicates whether the video can be embedded on another website."
* `status.madeForKids` — "This value indicates whether the video is designated as child-directed."
* `status.privacyStatus` — valid values `private`, `public`, `unlisted`.
* `status.uploadStatus` — valid values `deleted`, `failed`, `processed`, `rejected`, `uploaded`.
* `snippet.liveBroadcastContent` — valid values `live`, `none`, `upcoming`.

**CONFIRMED.** One batched call for all 8 ids costs 1 unit — the same as one call for one id — so
per-result enrichment would be 8× the cost for identical data. The implementation issues exactly one.

### NEW — thumbnail keys are *not* all 16:9

Quoted dimensions from the Video resource reference:

| key | size | ratio |
|---|---|---|
| `default` | 120 × 90 | 4:3 |
| `medium` | 320 × 180 | **16:9** |
| `high` | 480 × 360 | 4:3 |
| `standard` | 640 × 480 | 4:3 |
| `maxres` | 1280 × 720 | **16:9** |

`agents/25` requires an "unmodified 16:9 thumbnail". Only `medium` and `maxres` are natively 16:9;
`high` is a 4:3 image with pillarboxing baked in and would *look* wrong in a 16:9 frame. The
normaliser therefore prefers `maxres`, then `medium`, and falls back to the others only when neither
exists — recorded in `docs/reference-deviations.md` as D-28.

---

## 4. Embedded player: minimum size

**Source:** <https://developers.google.com/youtube/terms/required-minimum-functionality>,
<https://developers.google.com/youtube/iframe_api_reference>

> "Embedded players must have a viewport that is at least 200px by 200px."

> "If the player displays controls, the player must be large enough to fully display the controls
> without shrinking the viewport below the minimum size."

> "We recommend 16:9 players be at least 480 pixels wide and 270 pixels tall."

**CONFIRMED.** The surface is built at 480 × 270 on desktop and, on narrow screens, full-width with a
16:9 box and a hard `min-width: 200px; min-height: 200px` floor, asserted in CSS and in tests.

---

## 5. Autoplay and visibility

**Source:** <https://developers.google.com/youtube/terms/required-minimum-functionality>

> "An API Client must not initiate an automatic playback until the player is visible and more than
> half of the player is visible on the page or screen."

**CONFIRMED**, verbatim. This is a hard requirement, not a recommendation.

Implementation:

* A direct click on a YouTube result reveals the surface first and then plays — user-initiated, and
  the surface is visible in any case.
* Any **scripted** transition (queue advance, "play next") calls `cueVideoById` and requires an
  explicit play press unless an `IntersectionObserver` reports `intersectionRatio > 0.5` **and**
  `document.visibilityState === 'visible'`. If the observer has not reported yet, the item is cued and
  never auto-played — the uncertain case resolves to *do not autoplay*, as `agents/21` requires.
* The `autoplay` playerVar is `0`; the documented default is also `0`
  (<https://developers.google.com/youtube/player_parameters>). Nothing YouTube-related runs on page
  load at all: the IFrame API script is not injected until the first YouTube play.

---

## 6. Background playback, extraction, downloads, ads, overlays

**Source:** <https://developers.google.com/youtube/terms/developer-policies>

| Policy | Verbatim | Compliance |
|---|---|---|
| III.I.9 | "create, include, or promote features that play content, including audio or video components, from a background player, meaning a player that is not displayed in the page, tab, or screen that the user is viewing" | The player is always on-screen while playing; `document.visibilitychange` → hidden pauses it; closing the surface stops it. |
| III.I.7 | "separate, isolate, or modify the audio or video components of any YouTube audiovisual content" | No extraction anywhere. A YouTube item can never reach `HTMLAudioElement` — enforced by the type system (`MediaItem` union) and by an explicit runtime guard, both under test. |
| III.E.1.a | "download, import, backup, cache, or store copies of YouTube audiovisual content without YouTube's prior written approval" | No media bytes are ever fetched, proxied or stored. `/api/youtube` returns metadata only. |
| III.I.5 | "modify, interfere with, replace, or block advertisements placed or served by YouTube or by YouTube API Services" | No ad handling of any kind exists. |
| III.I.4 | "you must not remove, obscure, alter, or disable any links that appear in YouTube players" | Native controls stay on (`controls=1`); nothing is drawn over the iframe. |
| III.I.21 | "situate the YouTube player in a nested or hierarchical iframe lineage to circumvent YouTube policies or otherwise obfuscate the source of use" | One player, one iframe, created by the official IFrame API in a plain container. |

**Overlays**, from Required Minimum Functionality:

> "You must not display overlays, frames, or other visual elements in front of any part of a YouTube
> embedded player, including player controls."

**CONFIRMED.** The player container has no descendants other than the API-created iframe; the close
button, title and attribution are siblings placed *outside* it in the layout, and a test asserts the
iframe container has exactly one child and no positioned sibling covering it.

---

## 7. International queries

`search.list` documents `relevanceLanguage` as "typically an ISO 639-1 two-letter language code" and
`q` as a plain query term. Nothing in the documentation asks a client to transliterate.

Implementation: the query is passed through **literally**, percent-encoded by `URLSearchParams` only.
Armenian, Arabic and Cyrillic text reaches Google byte-for-byte. `relevanceLanguage` is attached only
for the two unambiguous script→language mappings `agents/22` permits (`hy` for Armenian script, `ar`
for Arabic script) and is **never** guessed for Cyrillic, which spans Russian, Ukrainian, Bulgarian,
Serbian, Macedonian and more. Attaching `relevanceLanguage` costs no extra quota — it is a parameter
on the single request, not a second request.

---

## 8. Referrer

**Source:** <https://developers.google.com/youtube/terms/required-minimum-functionality>

> "API Clients that use the YouTube embedded player (including the YouTube IFrame Player API) must
> provide identification through the `HTTP Referer` request header."

> "YouTube recommends using `strict-origin-when-cross-origin` Referrer-Policy, which is already the
> default in many browsers."

> "API Clients must not use the `noreferrer` feature, which suppresses the `Referer` value."

**CONFIRMED**, and this is the exact string `agents/23` predicted.

Audit result: `vercel.json` already sends `Referrer-Policy: strict-origin-when-cross-origin` on
`/(.*)` from Phase 1 — **already correct, unchanged**. `index.html` carries no `<meta name="referrer">`
and none was added. No YouTube-related link uses `rel="noreferrer"`: the outbound watch links use
`rel="noopener"` only, and `noopener` on its own does not strip the `Referer`. Verified by a unit test
over `vercel.json` and `index.html`, and by a component test asserting no YouTube anchor carries
`noreferrer`.

`origin` playerVar, per <https://developers.google.com/youtube/player_parameters>:

> "This parameter provides an extra security measure for the IFrame API and is only supported for
> IFrame embeds. If you are using the IFrame API, which means you are setting the `enablejsapi`
> parameter value to 1, you should always specify your domain as the `origin` parameter value."

Implemented: `enablejsapi: 1` and `origin: window.location.origin`.

### NEW — `modestbranding` is deprecated

> "This parameter is deprecated and has no effect."

It is therefore **not** used. (`rel=0` is also not used: per the same page it no longer disables
related videos, it only restricts them to the same channel, so setting it would be a no-op dressed up
as a preference.)

---

## 9. MadeForKids

**Source:** <https://developers.google.com/youtube/v3/guides/made_for_kids_status>

Retrieval — call the `videos.list` endpoint with the `id` and `status` parts, then read
`status.madeForKids`. Implemented exactly: the single batched `videos.list` requests
`snippet,contentDetails,status`.

Obligation when embedding, quoted:

> "turn off tracking and make sure that all data collection, with respect to that player, is compliant
> with applicable laws, including U.S. Children's Online Privacy Protection Act (COPPA)."

referencing Developer Policies §III.E.4.j.

### Decision: MFK videos are **not embedded**

The obligation is to turn off tracking and warrant full COPPA compliance *for that player*. Checking
whether a documented mechanism exists to discharge it:

* The IFrame Player API reference documents a constructor taking `width`, `height`, `videoId`,
  `playerVars` and `events` **only**. There is **no documented `host` option**, and
  `youtube-nocookie.com` is not mentioned anywhere in the IFrame API reference. Using an undocumented
  constructor option would itself violate `agents/21` ("Do not modify YouTube player behavior outside
  documented APIs").
* Privacy-enhanced mode is documented on the *support* site
  (<https://support.google.com/youtube/answer/171780>) as "Change the domain for the embed URL in your
  HTML from `https://www.youtube.com` to `https://www.youtube-nocookie.com`", and it states views
  "will not be used to personalize advertising shown to the viewer outside of your site or app". That
  is narrower than "turn off tracking", and the same page still says a child-directed site "must
  self-designate your site or app". On its own text it does not discharge §III.E.4.j.
* No documented API surface lets this application assert COPPA-compliant data collection for a player
  embedded in a general-audience site.

So, following `agents/26` → "If a compliant implementation is not clear/achievable within this simple
architecture: do not embed it": a result with `status.madeForKids === true` is **kept visible, clearly
labelled, and external-only**. Its play control is replaced by *Watch on YouTube*, which opens the
video on YouTube itself where YouTube applies its own kids handling. `embeddable: false` and a
non-`public` privacy status are handled the same way. This is a deliberate, documented limitation, not
an oversight.

`madeForKids` can also legitimately be **absent/null** for a video. Null is treated as *not known
safe*: an item is embeddable only when the field is explicitly `false`.

---

## 10. Attribution and branding

**Source:** <https://developers.google.com/youtube/terms/branding-guidelines>

> "You cannot modify the colors of the YouTube logos or YouTube Icons."

> "Any YouTube logo or YouTube Icon that you display must meet the minimum size requirements."

> "Any YouTube logo used within an application must link back to YouTube content or to a YouTube
> component of that application."

**Decision: word-mark text attribution, no drawn logo.** The official logo and icon assets are
distributed from YouTube's brand resources site under fixed colour, size and clear-space rules. This
build does not ship those asset files, and hand-drawing an approximation — or repurposing a generic
icon-font glyph — would be exactly the modified logo the guidelines forbid. So every YouTube result
instead carries:

* a plain-text **YouTube** source label (text is not a logo, so the logo rules do not bind it, and it
  makes the source unambiguous as §III.F requires),
* the channel title,
* a real anchor to `https://www.youtube.com/watch?v=<id>` — the link-back obligation,
* a section heading "YouTube results" so no YouTube row can be mistaken for an Audius or Jamendo row.

Documented in `docs/reference-deviations.md` D-28 … D-32.

---

## 11. Summary of what this audit changed versus the agent pack

1. **Thumbnails** — `high` (480 × 360) is 4:3, not 16:9. Prefer `maxres`/`medium`. (§3)
2. **`modestbranding`** is deprecated and has no effect; not used. `rel=0` no longer does what it is
   commonly assumed to do; not used. (§8)
3. **No `host` / `youtube-nocookie` option** exists in the documented IFrame API constructor, which is
   part of why MFK content is not embedded at all. (§9)
4. **`search.list` bills to its own quota bucket**; `videos.list` bills to the shared 10,000-unit pool,
   so enrichment is effectively free next to the search. (§1)
5. **`strict-origin-when-cross-origin` is named verbatim by YouTube** as its recommendation — the
   Phase 1 header was already correct and needed no change. (§8)
