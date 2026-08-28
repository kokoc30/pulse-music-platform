# 03 — Production Architecture

## Architectural Goal

Use the least infrastructure necessary to satisfy the product.

V1 does not need a database or dedicated backend.

---

## Recommended Stack

### Client

- React
- TypeScript
- Vite
- React Router
- Zustand
- `@audius/sdk`
- CSS/Tailwind/component system based on what the reference actually uses

Prefer retaining the reference styling technology when doing so materially improves fidelity and does not compromise maintainability.

### Test stack

- Vitest
- React Testing Library
- `@testing-library/user-event`
- MSW
- Playwright

### Hosting

Primary:
- Vercel static deployment

Backend:
- none for V1

---

## Runtime Data Flow

### Discovery

```text
Browser
  |
  | Audius SDK request
  v
Audius API
  |
  | normalized track metadata
  v
Provider adapter
  |
  v
React UI
```

### Search

```text
Search input
  |
  | debounce
  v
Search service
  |
  v
Audius provider
  |
  v
Normalize provider result
  |
  v
UI Track[]
```

### Playback

```text
User clicks track
  |
  v
Player store
  |
  v
Resolve/use Audius public stream
  |
  v
Single global HTMLAudioElement
  |
  v
Audius stream infrastructure
```

Do not route complete MP3 audio through Vercel or Render.

---

## Why No Render Backend

A separate Node/Express backend would add:

- another deploy,
- another failure domain,
- CORS configuration,
- environment duplication,
- cold-start/hosting concerns,
- unnecessary code,
- potential audio-proxy mistakes.

For V1's read-only Audius usage, a browser application is sufficient.

A backend may be introduced later only for a concrete reason such as:
- private secret-required integration,
- server-controlled caching/rate limiting,
- server-side aggregation,
- authentication,
- paid/gated content,
- protected business logic.

Do not add it preemptively.

---

## Provider Boundary

Never call Audius directly from arbitrary UI components.

Create one provider boundary.

Conceptual contract:

```ts
export interface MusicProvider {
  searchTracks(query: string, options?: SearchOptions): Promise<Track[]>
  getTrendingTracks(options?: TrendingOptions): Promise<Track[]>
  getTrack(id: string): Promise<Track | null>
  getStreamSource(track: Track): Promise<string> | string
}
```

Use a normalized domain model:

```ts
export interface Track {
  id: string
  provider: 'audius'
  providerId: string
  title: string
  artistId?: string
  artistName: string
  artwork: {
    small?: string
    medium?: string
    large?: string
  }
  durationSeconds: number
  genre?: string
  mood?: string
  playCount?: number
  permalink?: string
  isStreamable: boolean
}
```

The rest of the application should not depend on raw `TrackResponse`.

---

## App Layers

```text
UI components
    |
    v
feature hooks / player actions
    |
    v
domain services
    |
    v
music provider interface
    |
    v
Audius adapter
```

Avoid:
- giant `App.tsx`,
- API code inside card components,
- player event handling duplicated across pages,
- raw SDK types in every component.

---

## State Model

Use React local state for:
- local form/UI state,
- one-off dialog state.

Use Zustand for global playback:
- current track,
- queue,
- current queue index,
- playing/loading/error status,
- current time,
- duration,
- volume,
- muted,
- repeat,
- shuffle if reference contains it.

Search results do not need to live in global state unless reference navigation requires it.

---

## Audio Ownership

There must be exactly one logical global audio engine.

Preferred:
- one `HTMLAudioElement`,
- owned by a player service/provider,
- event listeners attached once,
- cleanly removed on teardown/HMR.

Do not create one `<audio>` per track row.

---

## Browser Constraints

Handle:
- autoplay restrictions,
- `play()` promise rejection,
- stale stream load,
- media errors,
- track ended,
- seek while metadata is not loaded,
- unknown duration,
- mobile Safari differences.

User click should be the initial playback gesture.

---

## Resilience

External API failures must not crash the app.

Use:
- request cancellation/AbortController where possible,
- stale-request protection,
- retry only where sensible,
- user-facing error state,
- logging without secrets,
- no infinite retry loops.

---

## Performance

Targets:
- no API request per keystroke,
- lazy load heavy overlays where practical,
- avoid re-rendering the entire application every audio `timeupdate`,
- memoize derived queue/current-track views only where needed,
- use responsive image URLs,
- do not preload dozens of audio streams,
- no audio blobs stored in React state.

---

## Production Routing

If using BrowserRouter on Vercel, ensure SPA rewrite support so direct URL refreshes resolve to the app.

Do not add routing configuration unless actual production routes require it.
