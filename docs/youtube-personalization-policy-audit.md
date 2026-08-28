# YouTube policy audit — Phase 4 (local personalization)

Re-audit performed **28 August 2026**, before any Phase 4 code was written, against the
**current** official Google/YouTube documentation only:

- [YouTube API Services — Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube API Services — Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube API Services — Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)

No blog post, Stack Overflow answer or third-party summary was used to reach a conclusion.
Phase 3's audit (`docs/youtube-policy-audit.md`) covered quota, the embedded player,
autoplay, MadeForKids and attribution, and **still stands unchanged**. This document covers
only what Phase 4 newly does: *keeping YouTube metadata on the device between visits.*

Where the documentation is ambiguous, this audit takes the stricter reading and says so.

---

## 0. What Phase 4 actually changes

Before Phase 4, YouTube metadata lived in a per-tab in-memory cache and was gone when the
tab closed. Phase 4 introduces one new capability:

> If the visitor turns on personalization, a YouTube video they **played** is remembered in
> `localStorage` so it can appear in a *Recently played* shelf.

Everything else about YouTube is untouched: the same one search per explicit submission, the
same visible IFrame player, the same attribution, the same MadeForKids handling.

Three questions therefore had to be answered:

1. May that metadata be stored at all, and for how long?
2. May it be *displayed* later, after it was retrieved?
3. May it influence the app's music recommendations?

The answers are **yes / yes with a condition / no**, and each is enforced in code.

---

## 1. Is this Authorized or Non-Authorized Data?

The Developer Policies distinguish **Authorized Data** (obtained with a specific user's
OAuth consent) from **Non-Authorized Data** (everything else).

Pulse has no OAuth, no sign-in, no YouTube account access and no authorization tokens. Its
only YouTube requests are server-side, API-key-authenticated `search.list` and `videos.list`
calls for public video metadata.

> **Conclusion:** everything Pulse holds is **Non-Authorized Data**. §III.E.4.d governs it.
> §III.E.4.a–c (tokens, analytics, authorized data) do not apply, and Pulse must not drift
> into them — which it structurally cannot, having no authorization flow at all.

---

## 2. Retention limit

> §III.E.4.d — "API Clients may temporarily store limited amounts of **Non-Authorized Data**
> for as long as is necessary for the purposes of the API Client but **not longer than 30
> calendar days**."

Two obligations, both binding:

| Obligation | How Phase 4 satisfies it |
| --- | --- |
| **"limited amounts"** | Only videos the visitor actually *played* — not search results, not impressions. Nine fields per row (§5), inside a 250-item history that is itself capped. |
| **"not longer than 30 calendar days"** | `YOUTUBE_RETENTION_DAYS = 30` in `src/personalization/config.ts`, enforced by `src/personalization/youtube-retention.ts`. |

**Implementation.**

- Every YouTube row carries `storedAt`, set at the moment the metadata was retrieved.
- `isExpiredYouTubeEntry` returns `true` at `storedAt <= now - 30 days` — **at** the limit,
  not after it.
- The purge runs at start-up (`hydrate`), on a six-hour interval while a tab stays open, and
  again in `pruneHistory` on every write. A tab left open for a month cannot surface a stale
  row, and neither can a hand-restored `localStorage` backup.
- The purge writes through to disk, so expired rows are *deleted*, not merely hidden.

**Refreshing.** Playing a video again is a fresh, permitted retrieval of its metadata, so
`storedAt` is reset at that moment and the 30 days start again. Nothing else extends the
window: rendering the shelf, reloading the page and opening Settings all leave `storedAt`
untouched.

**Catalogue history is a separate rule.** Audius and Jamendo rows use a 180-day window and
a 250-item cap. The two rules never share a code path, and `pruneHistory` applies the
YouTube purge **first**, so a YouTube row past 30 days is deleted even when the catalogue
caps would have kept it.

> Tested by `src/personalization/youtube-policy.test.ts` (28 assertions) and
> `tests/e2e/personalization.spec.ts` → "an expired entry has disappeared".

---

## 3. May previously-retrieved metadata be displayed later?

Yes, with a condition, and the condition is met.

> §III.E.4.e — "API Clients must use reasonable efforts to ensure that their stored API Data
> is consistent with the current data available through YouTube API Services."
>
> §III.E.4.f — "API Clients must display the most updated API Data available in their
> user-facing presentations … **although API Clients may display historical API Data
> provided that it is presented accurately in context of time**."

A *Recently played* shelf is precisely the case §III.E.4.f contemplates: it is historical
API Data, and it is presented in an explicit temporal context — the shelf is titled
**"Recently played"**, ordered most-recent-first, and carries the line *"Kept on this device
only."* It does not present the stored title or thumbnail as current catalogue state.

"Reasonable efforts" for consistency (§III.E.4.e) are the 30-day ceiling plus refresh-on-play.
Pulse deliberately does **not** poll `videos.list` to refresh stored rows: that would spend
daily quota on background requests for data the visitor may never look at again, and would
contradict Phase 3's quota discipline. Letting a row expire is the more conservative choice.

---

## 4. May YouTube data influence recommendations? — **No.**

> §III.E.4.h — "Your API Clients must not (i) replace API Data with similar, independently
> calculated data, or (ii) **access or use API Data to create new or derived data or
> metrics**."
>
> §III.E.2.a — "Do not aggregate API Data except that you may only aggregate API Data
> relating to YouTube channels that are under the same content owner."

A cross-provider preference score built partly from YouTube metadata would be exactly the
"new or derived data or metrics" §III.E.4.h prohibits, and aggregating across unrelated
channels would breach §III.E.2.a. Phase 4 therefore excludes YouTube from scoring
**structurally, not by convention**:

- `catalogEntries()` filters every YouTube row out of the history *before* any weight is
  computed. It is the first line of `buildProfile`, and it is the only entry point to the
  profile.
- No YouTube field reaches `artistWeights`, `genreWeights`, `tokenWeights` or
  `scriptWeights`. A YouTube channel can never become an "artist you like".
- YouTube plays do not count toward `qualifiedListenCount`, so they cannot move the profile
  stage and therefore cannot cause a recommendation shelf to appear.
- The recommendation candidate pool is Audius/Jamendo `Track`s only. There is no code path
  by which a `YouTubeVideoItem` could enter it — the type union makes this a compile-time
  property.

> Proven by `youtube-policy.test.ts` → "produces an identical profile with and without
> YouTube history": adding 99 YouTube plays to a history leaves every weight byte-identical.

### The one thing that *is* permitted: the visitor's own query

If someone types `سارية السواس`, that string is **first-party user input to Pulse**, not API
Data. It never came from YouTube. It may therefore contribute to Pulse's local preference
profile regardless of which result the visitor eventually played.

The line drawn in code is exact:

| Signal | Source | Used for preferences? |
| --- | --- | --- |
| The query the visitor typed | The visitor | **Yes** |
| Title/channel of a YouTube video they played | YouTube API | **No** |
| Title/artist of an Audius or Jamendo track they played | Audius/Jamendo API | **Yes** |

Pulse never inspects YouTube metadata to infer a preference — e.g. it never reads a video's
title to conclude "this listener likes Arabic-language music". That inference would be
derived data under §III.E.4.h, and the stricter reading is applied.

---

## 5. What is stored, exactly

Nine fields per YouTube row, all of which are already visible on screen:

| Field | Why it is kept |
| --- | --- |
| `providerItemId` (video id) | Identity, and the watch-page link |
| `title` | Shown on the card |
| `artist` (channel title) | Shown on the card — the attribution §III.E.10 requires |
| `thumbnailUrl` | The **address** of YouTube's own image, never the image |
| `durationSeconds` | Shown on the card |
| `sourceUrl` | The required backlink to the watch page |
| `embeddable`, `madeForKids` | Needed to keep §9 of the Phase 3 audit enforceable on replay |
| `storedAt` | The retention clock itself |
| play counters (`playCount`, `playedSeconds`, …) | **Pulse's own** measurements of local playback, not API Data |

### What is never stored

| Never stored | Enforced by |
| --- | --- |
| Audiovisual content, in any form (§III.E.1) | Nothing in the app ever holds media bytes; `toPersisted` has no field that could |
| A cached or re-hosted thumbnail image | Only the URL is kept; the `<img>` loads from `i.ytimg.com` directly |
| Extracted or separated audio (§III.I.7) | A YouTube item is never a `Track`; the type system forbids it reaching `<audio>` |
| View counts, likes, ratings, comment or subscriber counts, engagement | Never requested by `server/youtube/`, never normalized into `YouTubeVideoItem`, no field in `toPersisted` |
| Any derived YouTube metric | §4 above |
| API keys or credentials | `YOUTUBE_API_KEY` is server-only; `toPersisted` is an explicit allow-list |

Storage is written by `toPersisted()`, which constructs the persisted object **one named
field at a time and never spreads a source object**. A widened provider payload therefore
cannot leak into storage: the only way to persist a new field is to add a line to that
function.

> Tested by `storage.test.ts` → "the persisted shape is an allow-list", which walks every
> key at every depth, and by `youtube-policy.test.ts` → "keeps only the metadata already
> displayed on screen", which asserts the exact key set.

---

## 6. No automatic YouTube requests from the home page

Phase 3's quota architecture is unchanged and Phase 4 adds nothing to it. The personalized
home page:

- makes **no** `search.list` or `videos.list` request, ever;
- does **not** prefetch, refresh or revalidate stored YouTube metadata;
- does **not** load the IFrame player script until a video is actually played;
- builds recommendations only from the Audius/Jamendo pool the page already fetched.

The single YouTube network request a personalized home page can make is the **thumbnail
image** for a Recently Played card, loaded from `i.ytimg.com`. That is not an API call, costs
no quota, and is required: the policies say the image must be shown as YouTube serves it
rather than copied or re-hosted.

> Proven by `tests/e2e/personalization.spec.ts` → "loading Home spends no YouTube quota,
> however much is stored", which records all network traffic across two full page loads with
> a YouTube item on screen and asserts the API-call list is empty.

---

## 7. Deletion rights

> §III.E.4.g — clients must "provide a way for a user to request that you delete stored data
> related to that user" and "must then delete it as soon as possible and **within 7 calendar
> days**."

Pulse deletes **immediately**, and offers four independent routes:

1. **Settings → Clear listening history** — removes every row, YouTube included.
2. **Settings → Reset recommendations** — removes every personalization signal.
3. **Settings → Turn off** — declining personalization deletes what was already stored.
4. Clearing browser data, which removes the single `localStorage` key.

There is no server copy to delete, no backup, and no propagation delay, because the data
never left the device.

---

## 8. Privacy policy requirements

> §III.A.2 — the privacy policy must be "prominently displayed and easily accessible to users
> at all times" and must "clearly and comprehensively explain to users what user information
> … the API Client accesses, collects, stores".

`/privacy` is linked from the footer of every page, from the sidebar and from the settings
page. Phase 4 updated it because one sentence had become false — it previously said Pulse
"does not keep a listening history". It now states, in plain language:

- that a listening history is kept **only when the visitor turns it on**;
- that it lives in this browser and is never uploaded, with no account and no sync;
- exactly which YouTube fields are kept, that they are deleted within 30 days, that no
  YouTube statistics are stored, and that YouTube data plays no part in recommendations;
- that Google/YouTube receive information during player use, with links to the Google
  Privacy Policy and the YouTube Terms of Service.

**Consent.** The current documentation does not require explicit opt-in consent before
serving public metadata to an unauthenticated visitor. Pulse asks anyway, once, in a
non-blocking strip with two equally-weighted buttons, and stores nothing until the visitor
answers. This is stricter than the documentation requires — the stricter reading, per the
rule at the top of this audit.

---

## 9. Made For Kids, on replay

Phase 3 decided MFK videos are never embedded (`docs/youtube-policy-audit.md` §9). Phase 4
must not create a back door around that through stored history, so
`canReplayStoredYouTubeEntry` re-checks the whole rule at *both* render time and click time:

- retention window still open, **and**
- `embeddable === true`, **and**
- `madeForKids === false` — an explicit `false`. A `null` (YouTube did not report it) is
  **not** good enough and the entry is not offered.

An entry failing any check is dropped from the shelf entirely rather than shown as a dead
card. §III.E.4.i's tracking obligations for MFK content cannot arise, because an MFK video
never reaches the player at all.

---

## 10. Summary

| Question | Answer | Where enforced |
| --- | --- | --- |
| Store YouTube metadata locally? | Yes — Non-Authorized Data, ≤ 30 days | `youtube-retention.ts` |
| Store media bytes or thumbnails? | **Never** | `storage.ts` → `toPersisted` |
| Store statistics or engagement? | **Never requested, never stored** | `server/youtube/sanitize.ts`, `toPersisted` |
| Show retained items later? | Yes — historical data in a time context (§III.E.4.f) | *Recently played* shelf |
| Feed recommendations? | **No** — §III.E.4.h | `profile.ts` → `catalogEntries` |
| Use the visitor's own typed query? | Yes — first-party input, not API Data | `history.ts` → `recordSubmittedSearch` |
| Automatic quota spend from Home? | **Zero** | `useHomeDashboard.ts` |
| Deletion on request? | Immediate, four routes | `SettingsPage.tsx` |
| Attribution preserved? | Yes — channel name and watch-page link on every card | `HistoryCard.tsx` |
| MFK / non-embeddable on replay? | Never played, never offered | `canReplayStoredYouTubeEntry` |
