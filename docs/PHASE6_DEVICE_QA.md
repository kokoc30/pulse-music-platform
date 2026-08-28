# Phase 6 — physical-device QA

## Status of this document

**No physical phone or tablet was available to the agent implementing Phase 6.**

Every row that requires real hardware is therefore marked **UNVERIFIED**. None of
them is marked PASS, and none of the automated evidence below is presented as a
substitute for them: a desktop Chromium tab cannot tell you whether audio
survives an Android screen lock, whether the iOS lock screen renders the artwork,
or whether a Bluetooth car stereo's Next button reaches the page.

Fill this in before claiming Phase 6 is fully done. Until then the phase status
is `PARTIAL — implementation PASS, physical-device background verification
pending`.

---

## What *was* verified, and on what

Automated, in real Chromium via Playwright against the production build
(`tests/e2e/background-autoplay.spec.ts`, 14 tests × 2 viewport projects):

| Verified | How |
| --- | --- |
| The app registers `play`, `pause`, `stop`, `previoustrack`, `nexttrack`, `seekto`, `seekbackward`, `seekforward` | Handlers captured from a wrapped `setActionHandler` |
| Metadata reaches the session with a real title, artist and artwork list | Observed on `mediaSession.metadata` |
| An OS **pause** and **play** drive the real `<audio>` element | Handlers invoked exactly as the OS invokes them |
| An OS **next** changes the current track, through the same action the on-page button uses | Compared the player bar before and after |
| An OS **seek** moves the real element's `currentTime` | Read back from the element |
| An OS **stop** halts playback | Read back from the element |
| **A hidden document does not pause audio** | `visibilitychange` dispatched with `visibilityState: 'hidden'`; the element stayed unpaused |
| **Handing playback to YouTube clears every registered handler** | Every entry in the registry asserted `null` |
| **YouTube still pauses when the document is hidden** | The fake IFrame player reported `playing: false` |
| Autoplay continues the session when the queue empties, with **zero** YouTube API calls | Network recorded across the whole run |
| Autoplay off stops at the end of the queue | Element asserted paused |
| Manifest is served, valid, and every declared icon 200s | `page.request` against the built app |

That is the *wiring*. What it cannot establish is the *platform behaviour* — which
is precisely what the table below is for.

---

## Physical-device checklist

Mark each row `PASS`, `FAIL` or `N/A`, and add the device, OS version and browser
version actually used. Replace `UNVERIFIED` only after running the step on the
hardware named in the row.

### Android — Chrome (browser tab)

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| A1 | Audius track keeps playing after the screen locks | UNVERIFIED | |
| A2 | Audius track keeps playing when Chrome is backgrounded | UNVERIFIED | |
| A3 | Jamendo track keeps playing after screen lock | UNVERIFIED | |
| A4 | Notification shows the correct title | UNVERIFIED | |
| A5 | Notification shows the correct artist | UNVERIFIED | |
| A6 | Notification shows the correct artwork | UNVERIFIED | Artwork is served from Audius content nodes; a node outage shows the fallback |
| A7 | Notification **pause** works | UNVERIFIED | |
| A8 | Notification **play** resumes | UNVERIFIED | |
| A9 | Notification **next** advances | UNVERIFIED | |
| A10 | Notification **previous** goes back | UNVERIFIED | |
| A11 | Seek bar appears and scrubbing works | UNVERIFIED | Depends on `setPositionState` support |
| A12 | Wired headset play/pause button works | UNVERIFIED | |
| A13 | Bluetooth transport controls work | UNVERIFIED | Name the device used |
| A14 | Dismissing the notification stops playback | UNVERIFIED | Behaviour varies by OS version |
| A15 | Returning to the app shows the correct current track and position | UNVERIFIED | |
| A16 | **A YouTube video does NOT continue when backgrounded** | UNVERIFIED | Must fail to play. This is a policy requirement, not a preference |
| A17 | **No lock-screen controls appear while YouTube is the active player** | UNVERIFIED | |
| A18 | Autoplay continues after screen lock when the queue empties | UNVERIFIED | |

### Android — installed PWA

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| B1 | Installs from Chrome's own prompt, or from Settings → Install Pulse | UNVERIFIED | |
| B2 | Launches standalone, with no browser chrome | UNVERIFIED | |
| B3 | Icon on the launcher is the Pulse mark, not clipped by the mask | UNVERIFIED | Maskable icon is `pulse-icon-maskable-512.png` |
| B4 | Splash uses the black background, with no white flash | UNVERIFIED | |
| B5 | Audio survives screen lock | UNVERIFIED | |
| B6 | Audio survives switching to another app | UNVERIFIED | |
| B7 | Notification metadata and controls behave as A4–A14 | UNVERIFIED | |
| B8 | Playback stops when the app is force-closed | UNVERIFIED | **Expected.** Not a defect — see Known limitations |
| B9 | Autoplay continues in the background | UNVERIFIED | |
| B10 | An update does not reload the app mid-track | UNVERIFIED | Deploy twice while a track plays |

### iPhone — Safari (browser tab)

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| C1 | Audius track keeps playing after screen lock | UNVERIFIED | iOS Safari is the most restrictive target |
| C2 | Audio keeps playing when Safari is backgrounded | UNVERIFIED | |
| C3 | Lock screen shows title and artist | UNVERIFIED | |
| C4 | Lock screen shows artwork | UNVERIFIED | |
| C5 | Lock-screen **play/pause** works | UNVERIFIED | |
| C6 | Lock-screen **next/previous** works | UNVERIFIED | iOS sometimes shows scrubbing instead of track skip |
| C7 | Control Centre shows the same state | UNVERIFIED | |
| C8 | Headset/AirPods controls work | UNVERIFIED | |
| C9 | Returning to the tab shows the correct track and position | UNVERIFIED | |
| C10 | **A YouTube video does NOT continue when backgrounded** | UNVERIFIED | |
| C11 | Autoplay continues after screen lock | UNVERIFIED | |

### iPhone — installed web app (Add to Home Screen)

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| D1 | Settings → Install Pulse shows the Add to Home Screen steps **only after pressing "How to install"** | UNVERIFIED | The steps must not appear unprompted |
| D2 | Adds to the home screen with the Pulse icon | UNVERIFIED | Uses `apple-touch-icon` |
| D3 | Launches standalone | UNVERIFIED | |
| D4 | Audio survives screen lock | UNVERIFIED | |
| D5 | Audio survives app switching | UNVERIFIED | |
| D6 | Lock-screen metadata and controls behave as C3–C8 | UNVERIFIED | |
| D7 | Playback stops when the app is force-closed | UNVERIFIED | **Expected.** |

### Cross-cutting

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| E1 | No provider audio appears in the service-worker cache | UNVERIFIED | DevTools → Application → Cache Storage. Automated equivalent passes |
| E2 | No `/api/*` response is cached | UNVERIFIED | Same |
| E3 | Local storage holds no stream URL, key or token | UNVERIFIED | Automated equivalent passes in the Phase 4/5 suites |
| E4 | Generated autoplay tracks appear in Recently Played under the normal rules | UNVERIFIED | Should qualify at `min(30s, 25%)`, floor 10s, like any other track |

---

## How to run this

1. Deploy, or serve the production build on a LAN address the phone can reach:
   `pnpm build && pnpm preview --host`. A service worker and installability both
   need a secure context — use HTTPS or `localhost` forwarding.
2. Open on the device, play an **Audius** track, lock the screen, and work down
   the table.
3. Repeat for a **Jamendo** track: it uses the same engine but a different stream
   host, and a mixed-provider queue is the realistic case.
4. Repeat the YouTube rows deliberately. A16, A17, C10 are the ones that would
   put the deployment out of compliance if they failed, so they matter more than
   any convenience row above them.
5. Record device, OS version and browser version beside each result.

---

## Known limitations to expect, not to file as bugs

- **Force-closing the app stops playback.** No web application can survive the OS
  reclaiming its process. Rows B8 and D7 exist to confirm this happens cleanly,
  not to be fixed.
- **Controls differ by platform.** iOS commonly offers scrubbing where Android
  offers track skip. `seekto`, `seekbackward` and `seekforward` are all
  registered; which appear is the platform's decision.
- **`setPositionState` is not universal.** Where it is missing, the notification
  simply shows no progress bar. Everything else still works.
- **Artwork depends on reachable content nodes.** Audius artwork is served by
  community-run nodes, and an unhealthy one shows the placeholder — on the lock
  screen as in the page. The session publishes the mirror URLs too, so it
  degrades identically to the rest of the app.
- **YouTube is intentionally absent from every background control.** That is the
  policy boundary of the phase, not a missing feature.
