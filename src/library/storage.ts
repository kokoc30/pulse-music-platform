import { migrateLibrary } from './migrations'
import { parseLibraryKey } from './track-ref'
import {
  LIBRARY_DB_NAME,
  LIBRARY_RECORD_KEY,
  LIBRARY_STORE_NAME,
  LIBRARY_VERSION,
  MAX_ARTWORK_MIRRORS,
  MAX_HIDDEN_KEYS,
  MAX_LIBRARY_TRACKS,
  MAX_LIKED_TRACKS,
  MAX_PLAYLISTS,
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  MAX_TRACKS_PER_PLAYLIST,
  createEmptyLibrary,
} from './types'
import type {
  LibraryProvider,
  LibraryState,
  LibraryStorageStatus,
  LibraryTrackRef,
  Playlist,
} from './types'

/**
 * The only code in the application allowed to touch library storage.
 *
 * **Why IndexedDB, when personalization uses `localStorage`.** The two stores
 * have different shapes. Personalization is a rolling window with hard caps —
 * 250 items, 50 searches — that never grows past a few tens of kilobytes, and it
 * is read once at start-up, so a synchronous `localStorage` read costs nothing.
 * A library is the opposite: it is meant to accumulate, a visitor is entitled to
 * keep a thousand liked songs and a hundred playlists, and every `localStorage`
 * access is synchronous on the main thread. Parsing a megabyte-scale JSON string
 * during hydration — and re-serializing all of it on every heart click — is
 * precisely the stall agents/41 warns about. IndexedDB is asynchronous, has an
 * origin quota orders of magnitude larger, and stores structured values rather
 * than a string.
 *
 * Volume, mute, autoplay and repeat stay exactly where they are, in
 * `localStorage`: they are tiny, and they are needed before the first frame.
 *
 * **One record, and therefore atomic by construction.** The whole state is a
 * single value under one key, so a write either lands completely or not at all.
 * That is what makes "add the track metadata *and* append the playlist key"
 * impossible to half-apply — there is no interleaving that could leave a
 * playlist pointing at a track that was never written (agents/41 →
 * "Transactions / consistency"). A per-entity schema would suit a far larger
 * library better and remains available behind this same interface.
 *
 * **Nothing crashes, and only allow-listed fields are written.** Every read is
 * rebuilt field by field from `unknown` by `sanitizeLibrary`; every write is
 * constructed field by field by `toPersistedLibrary`. There is no cast from a
 * stored payload to `LibraryState` anywhere in this file, and no path that
 * copies a provider object into storage.
 */

/* --------------------------------------------------------------------------
   Validation primitives
   -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonNegative(value: unknown, fallback = 0): number {
  const parsed = num(value)
  return parsed !== undefined && parsed >= 0 ? parsed : fallback
}

/** Only `http(s)` URLs survive, so a hand-edited `javascript:` can never render. */
function safeUrl(value: unknown): string | undefined {
  const raw = str(value, 2000)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : undefined
  } catch {
    return undefined
  }
}

/** Bounded list of `http(s)` origins — image hosts, and nothing else. */
function safeOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const origins: string[] = []
  for (const candidate of value) {
    if (origins.length >= MAX_ARTWORK_MIRRORS) break
    const raw = str(candidate, 300)
    if (!raw) continue
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      if (!origins.includes(url.origin)) origins.push(url.origin)
    } catch {
      continue
    }
  }
  return origins
}

const PROVIDERS: readonly LibraryProvider[] = ['audius', 'jamendo', 'youtube']

function providerOf(value: unknown): LibraryProvider | undefined {
  return PROVIDERS.includes(value as LibraryProvider) ? (value as LibraryProvider) : undefined
}

/**
 * Playlist names are visitor text, stored verbatim after trimming.
 *
 * Unicode is preserved exactly — no transliteration, no case folding, no
 * stripping of scripts. Nothing in the app interprets a playlist name as markup:
 * it is only ever set as a React text child, which escapes it.
 */
export function normalizePlaylistName(value: unknown): string | undefined {
  return str(value, MAX_PLAYLIST_NAME_LENGTH)
}

export function normalizePlaylistDescription(value: unknown): string | undefined {
  return str(value, MAX_PLAYLIST_DESCRIPTION_LENGTH)
}

/* --------------------------------------------------------------------------
   Entry sanitizers
   -------------------------------------------------------------------------- */

export function sanitizeTrackRef(value: unknown): LibraryTrackRef | null {
  if (!isRecord(value)) return null

  const provider = providerOf(value.provider)
  const providerItemId = str(value.providerItemId, 200)
  const title = str(value.title, 300)
  if (!provider || !providerItemId || !title) return null

  const addedAt = nonNegative(value.addedAt)
  const ref: LibraryTrackRef = {
    key: `${provider}:${providerItemId}`,
    provider,
    providerItemId,
    title,
    artist: str(value.artist, 300) ?? 'Unknown artist',
    addedAt,
    metadataUpdatedAt: nonNegative(value.metadataUpdatedAt, addedAt),
  }

  const artistId = str(value.artistId, 200)
  if (artistId) ref.artistId = artistId

  const duration = num(value.durationSeconds)
  if (duration !== undefined && duration > 0) ref.durationSeconds = duration

  const sourceUrl = safeUrl(value.sourceUrl)
  if (sourceUrl) ref.sourceUrl = sourceUrl

  if (provider === 'youtube') {
    // Only the address of YouTube's own thumbnail — never bytes, never a cropped
    // or re-hosted derivative, and never a statistic.
    const thumbnailUrl = safeUrl(value.thumbnailUrl)
    if (thumbnailUrl) ref.thumbnailUrl = thumbnailUrl
    ref.embeddable = value.embeddable === true
    ref.madeForKids = value.madeForKids === true ? true : value.madeForKids === false ? false : null
    // A missing or absurd expiry reads as "expired now" rather than "keeps
    // forever": the retention rule may not be lost to a bad write.
    ref.youtubeExpiresAt = nonNegative(value.youtubeExpiresAt)
  } else {
    const artwork = isRecord(value.artwork) ? value.artwork : undefined
    const url = safeUrl(artwork?.url)
    if (url) {
      ref.artwork = { url }
      const mirrors = safeOrigins(artwork?.mirrors)
      if (mirrors.length) ref.artwork.mirrors = mirrors
    }
    const genre = str(value.genre, 100)
    if (genre) ref.genre = genre
  }

  return ref
}

interface SanitizedPlaylist {
  playlist: Playlist
  /** True when a key had to be dropped, so the read reports itself recovered. */
  repaired: boolean
}

function sanitizePlaylist(value: unknown, knownKeys: Set<string>): SanitizedPlaylist | null {
  if (!isRecord(value)) return null
  const id = str(value.id, 80)
  const name = normalizePlaylistName(value.name)
  if (!id || !name) return null

  const createdAt = nonNegative(value.createdAt)
  const seen = new Set<string>()
  const itemKeys: string[] = []
  let repaired = false
  const rawKeys = Array.isArray(value.itemKeys) ? value.itemKeys : []
  if (!Array.isArray(value.itemKeys) && value.itemKeys !== undefined) repaired = true

  for (const candidate of rawKeys) {
    if (itemKeys.length >= MAX_TRACKS_PER_PLAYLIST) {
      repaired = true
      break
    }
    // A key with no surviving track reference is a dangling pointer. Dropping it
    // here is what guarantees the invariant every selector relies on: a playlist
    // never names a track the store cannot resolve. It is also a repair, and is
    // reported as one — a silent drop would let the read call itself clean.
    if (typeof candidate !== 'string' || !knownKeys.has(candidate) || seen.has(candidate)) {
      repaired = true
      continue
    }
    seen.add(candidate)
    itemKeys.push(candidate)
  }

  const playlist: Playlist = {
    id,
    name,
    createdAt,
    updatedAt: nonNegative(value.updatedAt, createdAt),
    itemKeys,
    coverMode: 'auto',
  }
  const description = normalizePlaylistDescription(value.description)
  if (description) playlist.description = description
  return { playlist, repaired }
}

/* --------------------------------------------------------------------------
   State-level sanitize
   -------------------------------------------------------------------------- */

export interface SanitizeLibraryResult {
  state: LibraryState
  /** True when something had to be dropped or repaired. */
  repaired: boolean
}

export function sanitizeLibrary(value: unknown, now = Date.now()): SanitizeLibraryResult {
  if (!isRecord(value)) return { state: createEmptyLibrary(now), repaired: true }

  let repaired = false

  const tracks: Record<string, LibraryTrackRef> = {}
  let trackCount = 0
  const rawTracks = isRecord(value.tracks) ? value.tracks : {}
  if (!isRecord(value.tracks) && value.tracks !== undefined) repaired = true
  for (const raw of Object.values(rawTracks)) {
    if (trackCount >= MAX_LIBRARY_TRACKS) {
      repaired = true
      break
    }
    const ref = sanitizeTrackRef(raw)
    if (!ref || tracks[ref.key]) {
      repaired = true
      continue
    }
    tracks[ref.key] = ref
    trackCount += 1
  }

  const knownKeys = new Set(Object.keys(tracks))

  const likedSeen = new Set<string>()
  const likedTrackKeys: string[] = []
  const rawLiked = Array.isArray(value.likedTrackKeys) ? value.likedTrackKeys : []
  if (!Array.isArray(value.likedTrackKeys) && value.likedTrackKeys !== undefined) repaired = true
  for (const candidate of rawLiked) {
    if (likedTrackKeys.length >= MAX_LIKED_TRACKS) {
      repaired = true
      break
    }
    if (typeof candidate !== 'string' || !knownKeys.has(candidate) || likedSeen.has(candidate)) {
      repaired = true
      continue
    }
    likedSeen.add(candidate)
    likedTrackKeys.push(candidate)
  }

  const playlists: Record<string, Playlist> = {}
  const playlistOrder: string[] = []
  const rawPlaylists = isRecord(value.playlists) ? value.playlists : {}
  if (!isRecord(value.playlists) && value.playlists !== undefined) repaired = true

  // The declared order comes first, so a stored arrangement survives; anything
  // it forgot is appended rather than lost.
  const declaredOrder = Array.isArray(value.playlistOrder)
    ? value.playlistOrder.filter((id): id is string => typeof id === 'string')
    : []
  const orderedIds = [...new Set([...declaredOrder, ...Object.keys(rawPlaylists)])]

  for (const id of orderedIds) {
    if (playlistOrder.length >= MAX_PLAYLISTS) {
      repaired = true
      break
    }
    const sanitized = sanitizePlaylist(rawPlaylists[id], knownKeys)
    if (!sanitized || playlists[sanitized.playlist.id]) {
      repaired = true
      continue
    }
    if (sanitized.repaired) repaired = true
    playlists[sanitized.playlist.id] = sanitized.playlist
    playlistOrder.push(sanitized.playlist.id)
  }

  const hiddenRecommendationKeys = Array.isArray(value.hiddenRecommendationKeys)
    ? [
        ...new Set(
          value.hiddenRecommendationKeys.filter(
            (id): id is string => typeof id === 'string' && parseLibraryKey(id) !== null,
          ),
        ),
      ].slice(0, MAX_HIDDEN_KEYS)
    : []
  if (
    !Array.isArray(value.hiddenRecommendationKeys) &&
    value.hiddenRecommendationKeys !== undefined
  ) {
    repaired = true
  }

  return {
    state: {
      version: LIBRARY_VERSION,
      tracks,
      likedTrackKeys,
      playlists,
      playlistOrder,
      hiddenRecommendationKeys,
      updatedAt: nonNegative(value.updatedAt, now),
    },
    repaired,
  }
}

/* --------------------------------------------------------------------------
   Serialization — the allow-list
   -------------------------------------------------------------------------- */

/**
 * Builds the persisted object explicitly, one named field at a time.
 *
 * This function is the security boundary. Because it never spreads a source
 * object, there is no path by which a stream URL, a signed URL, an API key, an
 * OAuth token, a raw provider response or a YouTube statistic can be written to
 * disk — the only way to persist a new field is to add a line here.
 */
export function toPersistedLibrary(state: LibraryState): Record<string, unknown> {
  const tracks: Record<string, unknown> = {}
  for (const ref of Object.values(state.tracks)) {
    const persisted: Record<string, unknown> = {
      provider: ref.provider,
      providerItemId: ref.providerItemId,
      title: ref.title,
      artist: ref.artist,
      addedAt: ref.addedAt,
      metadataUpdatedAt: ref.metadataUpdatedAt,
    }
    if (ref.artistId) persisted.artistId = ref.artistId
    if (ref.durationSeconds) persisted.durationSeconds = ref.durationSeconds
    if (ref.sourceUrl) persisted.sourceUrl = ref.sourceUrl
    if (ref.provider === 'youtube') {
      if (ref.thumbnailUrl) persisted.thumbnailUrl = ref.thumbnailUrl
      persisted.embeddable = ref.embeddable === true
      persisted.madeForKids = ref.madeForKids ?? null
      persisted.youtubeExpiresAt = ref.youtubeExpiresAt ?? 0
    } else {
      if (ref.artwork?.url) {
        const artwork: Record<string, unknown> = { url: ref.artwork.url }
        if (ref.artwork.mirrors?.length) {
          artwork.mirrors = ref.artwork.mirrors.slice(0, MAX_ARTWORK_MIRRORS)
        }
        persisted.artwork = artwork
      }
      if (ref.genre) persisted.genre = ref.genre
    }
    tracks[ref.key] = persisted
  }

  const playlists: Record<string, unknown> = {}
  for (const playlist of Object.values(state.playlists)) {
    const persisted: Record<string, unknown> = {
      id: playlist.id,
      name: playlist.name,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      itemKeys: playlist.itemKeys.slice(0, MAX_TRACKS_PER_PLAYLIST),
      coverMode: 'auto',
    }
    if (playlist.description) persisted.description = playlist.description
    playlists[playlist.id] = persisted
  }

  return {
    version: LIBRARY_VERSION,
    updatedAt: state.updatedAt,
    tracks,
    likedTrackKeys: state.likedTrackKeys.slice(0, MAX_LIKED_TRACKS),
    playlists,
    playlistOrder: state.playlistOrder.slice(0, MAX_PLAYLISTS),
    hiddenRecommendationKeys: state.hiddenRecommendationKeys.slice(0, MAX_HIDDEN_KEYS),
  }
}

/* --------------------------------------------------------------------------
   Repository
   -------------------------------------------------------------------------- */

export interface LibraryReadResult {
  state: LibraryState
  status: LibraryStorageStatus
}

/**
 * The persistence seam.
 *
 * Deliberately the shape agents/48 asks a future backend to reuse: read the
 * whole state, write the whole state, say whether writing is possible at all. An
 * `IndexedDbLibraryRepository` today; a `CloudLibraryRepository` or a
 * `SyncedLibraryRepository` later, with the store and every selector unchanged.
 */
export interface LibraryRepository {
  readonly kind: 'indexeddb' | 'memory'
  read: () => Promise<LibraryReadResult>
  write: (state: LibraryState) => Promise<'written' | 'unavailable'>
  clear: () => Promise<void>
}

/** True when this browser exposes a usable IndexedDB. */
export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    // Reading the property itself throws when storage is blocked by policy.
    return false
  }
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(LIBRARY_DB_NAME, 1)
    } catch (error) {
      reject(error instanceof Error ? error : new Error('IndexedDB open failed'))
      return
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(LIBRARY_STORE_NAME)) {
        database.createObjectStore(LIBRARY_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    // A blocked open resolves neither of the callbacks above, which would leave
    // hydration pending forever.
    request.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

export function createIndexedDbLibraryRepository(): LibraryRepository {
  let connection: Promise<IDBDatabase> | null = null

  const database = () => {
    connection ??= openDatabase()
    return connection
  }

  return {
    kind: 'indexeddb',

    async read() {
      let raw: unknown
      try {
        const db = await database()
        const transaction = db.transaction(LIBRARY_STORE_NAME, 'readonly')
        raw = await promisify(transaction.objectStore(LIBRARY_STORE_NAME).get(LIBRARY_RECORD_KEY))
      } catch {
        return { state: createEmptyLibrary(), status: 'unavailable' }
      }

      if (raw === undefined || raw === null) return { state: createEmptyLibrary(), status: 'ok' }

      const migrated = migrateLibrary(raw)
      if (migrated.kind === 'incompatible') {
        // Written by a newer build. Do not reinterpret it, and do not delete it.
        return { state: createEmptyLibrary(), status: 'incompatible' }
      }
      if (migrated.kind === 'unusable') {
        return { state: createEmptyLibrary(), status: 'recovered' }
      }

      const { state, repaired } = sanitizeLibrary(migrated.state)
      return { state, status: repaired ? 'recovered' : 'ok' }
    },

    async write(state) {
      try {
        const db = await database()
        const transaction = db.transaction(LIBRARY_STORE_NAME, 'readwrite')
        const done = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve()
          transaction.onabort = () => reject(transaction.error ?? new Error('aborted'))
          transaction.onerror = () => reject(transaction.error ?? new Error('failed'))
        })
        transaction
          .objectStore(LIBRARY_STORE_NAME)
          .put(toPersistedLibrary(state), LIBRARY_RECORD_KEY)
        await done
        return 'written'
      } catch {
        // Quota exhausted, storage revoked mid-session, or a private window that
        // only pretends to have IndexedDB. The library keeps working in memory.
        return 'unavailable'
      }
    },

    async clear() {
      try {
        const db = await database()
        const transaction = db.transaction(LIBRARY_STORE_NAME, 'readwrite')
        transaction.objectStore(LIBRARY_STORE_NAME).delete(LIBRARY_RECORD_KEY)
      } catch {
        // Nothing to do — the caller's in-memory state is already reset.
      }
    },
  }
}

/**
 * The fallback when no durable storage exists.
 *
 * It still holds state for the session, so likes and playlists behave normally
 * until the tab closes. The store reports `unavailable`, and the UI says so
 * once, without blocking anything (agents/41 → "graceful in-memory fallback").
 */
export function createMemoryLibraryRepository(): LibraryRepository {
  let held: LibraryState | null = null
  // Synchronous work behind an async interface: the promises are already
  // settled, so a memory-backed library never costs a frame.
  return {
    kind: 'memory',
    read: () => Promise.resolve({ state: held ?? createEmptyLibrary(), status: 'unavailable' }),
    write: (state) => {
      held = state
      return Promise.resolve('unavailable')
    },
    clear: () => {
      held = null
      return Promise.resolve()
    },
  }
}

export function createLibraryRepository(): LibraryRepository {
  return isIndexedDbAvailable()
    ? createIndexedDbLibraryRepository()
    : createMemoryLibraryRepository()
}
