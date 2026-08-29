# Library data model and persistence

## Separate library from personalization

Do not stuff playlists into `pulse.personalization.v1`.

Create a dedicated versioned library domain, for example:

```text
src/library/
  types.ts
  storage.ts
  store.ts
  selectors.ts
  migrations.ts
  actions.ts
  track-ref.ts
  index.ts
```

Suggested persisted version:

```text
pulse.library.v1
```

## Storage technology

Audit current storage size and conventions first.

Preferred design:

- non-sensitive tiny playback/UI preferences -> existing localStorage path
- potentially growing library metadata -> **IndexedDB**, behind one typed adapter
- if IndexedDB is unavailable -> graceful in-memory fallback, with a visible non-blocking warning

Do not access IndexedDB directly from React components.

Do not add a heavy database library unless it clearly reduces risk. A small typed native wrapper is acceptable.

## Core entities

Conceptual model:

```ts
type LibraryProvider = 'audius' | 'jamendo' | 'youtube'

interface LibraryTrackRef {
  key: string                  // provider:id
  provider: LibraryProvider
  providerItemId: string
  title: string
  artist: string
  artwork?: SafeArtworkRef
  durationSeconds?: number
  sourceUrl?: string
  addedAt: number
  metadataUpdatedAt: number
  youtubeExpiresAt?: number
}

interface Playlist {
  id: string                   // generated Pulse-local UUID
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  itemKeys: string[]
  coverMode: 'auto'
}

interface LibraryState {
  version: 1
  tracks: Record<string, LibraryTrackRef>
  likedTrackKeys: string[]
  playlists: Record<string, Playlist>
  hiddenRecommendationKeys: string[]
  updatedAt: number
}
```

Exact shape may adapt to repository conventions.

## Stable identity

Always identify a saved item by:

```text
provider + providerItemId
```

Examples:

```text
audius:abc123
jamendo:183920
youtube:dQw4w9WgXcQ
```

Never deduplicate solely by title/artist.

## Persist only safe metadata

Never persist:

- stream URLs
- signed URLs
- media bytes
- API keys
- OAuth tokens
- raw provider responses
- view/like statistics from YouTube
- Audio element state

Persist only the minimum display/re-resolution fields.

## Playlist rules

- max playlist count: choose a sane bounded value, e.g. 100 local playlists
- max tracks per playlist: choose a sane bounded value, e.g. 1000
- duplicate track in same playlist: default prevent
- same track may appear in multiple playlists
- remove unused track metadata when no longer liked and not referenced by any playlist, unless needed elsewhere by current local history
- playlist ordering is explicit and stable

## Liked Songs

Treat Liked Songs as a **virtual system collection**, not a normal mutable playlist object.

Route:

```text
/library/liked
```

The heart action toggles membership.

Do not allow deleting or renaming Liked Songs.

## Transactions / consistency

Multi-step library mutations must be atomic at the application layer.

Example:

```text
add track metadata
+
append playlist key
+
update timestamps
```

must not leave a playlist referencing a missing track if storage fails halfway.

Use one store transaction or rollback logic.

## Migration

Implement version checking.

Unknown future schema versions must fail safely.

Do not wipe existing Phase 4 personalization/history.

Library storage is independent.

## Export readiness

Design the persisted schema so a future JSON export/import is possible, but do not implement cloud sync in this phase.
