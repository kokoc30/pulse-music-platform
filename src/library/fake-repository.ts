import { sanitizeLibrary, toPersistedLibrary } from './storage'
import type { LibraryReadResult, LibraryRepository } from './storage'
import { createEmptyLibrary } from './types'
import type { LibraryState, LibraryStorageStatus } from './types'

/**
 * An in-process library repository that behaves like the real one.
 *
 * jsdom has no IndexedDB, so a component test cannot exercise the production
 * adapter. This double stands in its place and — crucially — round-trips every
 * write through the *same* `toPersistedLibrary` / `sanitizeLibrary` pair the
 * IndexedDB adapter uses. That is what makes "reload the page" testable: a test
 * that seeds this repository can only seed a shape production could have
 * written, and a test that reads it back gets exactly what production would have
 * read (the same discipline `seedPersonalization` follows for localStorage).
 *
 * Sits beside `fake-audio-engine.ts` for the same reason: it is a seam the
 * production code already declares, not a mock stitched over it.
 */
export interface FakeLibraryRepository extends LibraryRepository {
  /** Writes a state directly, as a previous session would have left it. */
  seed: (state: LibraryState) => void
  /** The persisted payload, exactly as it sits "on disk". */
  raw: () => Record<string, unknown> | null
  /** Writes an arbitrary payload — a corrupt or future-version record. */
  seedRaw: (payload: unknown) => void
  /** Makes every write fail, as an exhausted quota does. */
  setWritable: (writable: boolean) => void
  /** Writes performed. Asserts that a refused mutation persisted nothing. */
  writes: () => number
}

export function createFakeLibraryRepository(
  initial?: LibraryState | null,
): FakeLibraryRepository {
  let stored: unknown = initial ? toPersistedLibrary(initial) : null
  let writable = true
  let writeCount = 0

  const read = (): LibraryReadResult => {
    if (stored === null || stored === undefined) {
      return { state: createEmptyLibrary(), status: 'ok' }
    }
    const version = (stored as { version?: unknown }).version
    if (typeof version === 'number' && version > 1) {
      // Written by a newer build. Left alone, exactly as the real adapter does.
      return { state: createEmptyLibrary(), status: 'incompatible' }
    }
    if (typeof version !== 'number') {
      return { state: createEmptyLibrary(), status: 'recovered' }
    }
    const { state, repaired } = sanitizeLibrary(stored)
    return { state, status: repaired ? 'recovered' : 'ok' }
  }

  return {
    kind: 'indexeddb',
    read: () => Promise.resolve(read()),
    write: (state) => {
      if (!writable) return Promise.resolve('unavailable')
      writeCount += 1
      stored = toPersistedLibrary(state)
      return Promise.resolve('written')
    },
    clear: () => {
      stored = null
      return Promise.resolve()
    },
    seed: (state) => {
      stored = toPersistedLibrary(state)
    },
    seedRaw: (payload) => {
      stored = payload
    },
    raw: () => (stored === null ? null : (stored as Record<string, unknown>)),
    setWritable: (next) => {
      writable = next
    },
    writes: () => writeCount,
  }
}

export type { LibraryStorageStatus }
