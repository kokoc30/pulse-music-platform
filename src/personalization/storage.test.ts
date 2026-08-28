import { describe, expect, it } from 'vitest'
import {
  failingStorage,
  makeEntry,
  makeSearch,
  makeState,
  memoryStorage,
  NOW,
} from '@/test/fixtures/personalization'
import { MAX_HISTORY_ITEMS, MAX_SEARCH_HISTORY } from './config'
import {
  clearStoredState,
  isStorageAvailable,
  readState,
  sanitizeListenEntry,
  sanitizeState,
  toPersisted,
  writeState,
} from './storage'
import { migrate } from './migrations'
import { PERSONALIZATION_STORAGE_KEY, PERSONALIZATION_VERSION } from './types'

describe('personalization storage', () => {
  describe('default state', () => {
    it('starts empty, with consent unset and nothing recorded', () => {
      const { state, status } = readState(memoryStorage(), NOW)
      expect(status).toBe('ok')
      expect(state.consent).toBe('unset')
      expect(state.listeningHistory).toEqual([])
      expect(state.searchHistory).toEqual([])
      expect(state.version).toBe(PERSONALIZATION_VERSION)
    })

    it('round-trips a written state', () => {
      const storage = memoryStorage()
      const state = makeState({
        listeningHistory: [makeEntry({ id: 'trk1' }), makeEntry({ id: 'trk2', provider: 'jamendo' })],
        searchHistory: [makeSearch({ query: 'kosandra' })],
      })

      expect(writeState(state, storage)).toBe('written')
      const restored = readState(storage, NOW)
      expect(restored.status).toBe('ok')
      expect(restored.state.listeningHistory.map((entry) => entry.id)).toEqual([
        'audius:trk1',
        'jamendo:trk2',
      ])
      expect(restored.state.searchHistory[0].query).toBe('kosandra')
      expect(restored.state.consent).toBe('granted')
    })
  })

  describe('malformed and hostile input', () => {
    it('recovers from JSON that does not parse', () => {
      const storage = memoryStorage()
      storage.setItem(PERSONALIZATION_STORAGE_KEY, '{"listeningHistory": [')
      const { state, status } = readState(storage, NOW)
      expect(status).toBe('recovered')
      expect(state.listeningHistory).toEqual([])
    })

    it('recovers from a payload that is not an object', () => {
      const storage = memoryStorage()
      storage.setItem(PERSONALIZATION_STORAGE_KEY, '"just a string"')
      expect(readState(storage, NOW).status).toBe('recovered')
    })

    it('drops individual malformed rows and keeps the good ones', () => {
      const { state, repaired } = sanitizeState(
        {
          version: 1,
          consent: 'granted',
          listeningHistory: [
            makeEntry({ id: 'good' }),
            null,
            'nonsense',
            { provider: 'audius' },
            { provider: 'martian', providerItemId: 'x', title: 'y' },
            makeEntry({ id: 'good2' }),
          ],
          searchHistory: [makeSearch({ query: 'ok' }), 42, {}],
        },
        NOW,
      )

      expect(repaired).toBe(true)
      expect(state.listeningHistory.map((entry) => entry.providerItemId)).toEqual(['good', 'good2'])
      expect(state.searchHistory.map((entry) => entry.query)).toEqual(['ok'])
    })

    it('coerces impossible numbers rather than storing them', () => {
      const entry = sanitizeListenEntry({
        provider: 'audius',
        providerItemId: 'x',
        title: 'T',
        artist: 'A',
        playedSeconds: -50,
        completionRatio: 9,
        playCount: 2.7,
        skipCount: Number.NaN,
        durationSeconds: Number.POSITIVE_INFINITY,
      })

      expect(entry).not.toBeNull()
      expect(entry?.playedSeconds).toBe(0)
      expect(entry?.completionRatio).toBe(1)
      expect(entry?.playCount).toBe(2)
      expect(entry?.skipCount).toBe(0)
      expect(entry?.durationSeconds).toBeUndefined()
    })

    it('refuses a non-http URL that was hand-edited into storage', () => {
      const entry = sanitizeListenEntry({
        provider: 'audius',
        providerItemId: 'x',
        title: 'T',
        artist: 'A',
        artworkUrl: 'javascript:alert(1)',
        sourceUrl: 'https://audius.co/ok',
      })
      expect(entry?.artworkUrl).toBeUndefined()
      expect(entry?.sourceUrl).toBe('https://audius.co/ok')
    })

    it('deduplicates rows that share a provider id', () => {
      const { state } = sanitizeState(
        {
          version: 1,
          listeningHistory: [makeEntry({ id: 'same' }), makeEntry({ id: 'same' })],
        },
        NOW,
      )
      expect(state.listeningHistory).toHaveLength(1)
    })

    it('keeps two items with the same id from different providers', () => {
      const { state } = sanitizeState(
        {
          version: 1,
          listeningHistory: [
            makeEntry({ id: '99', provider: 'audius' }),
            makeEntry({ id: '99', provider: 'jamendo' }),
          ],
        },
        NOW,
      )
      expect(state.listeningHistory).toHaveLength(2)
    })
  })

  describe('caps', () => {
    it('trims listening history to the cap, keeping the most recent', () => {
      const history = Array.from({ length: MAX_HISTORY_ITEMS + 20 }, (_, index) =>
        makeEntry({ id: `t${index}`, daysAgo: index }),
      )
      const { state, repaired } = sanitizeState({ version: 1, listeningHistory: history }, NOW)
      expect(repaired).toBe(true)
      expect(state.listeningHistory).toHaveLength(MAX_HISTORY_ITEMS)
      expect(state.listeningHistory[0].providerItemId).toBe('t0')
    })

    it('trims search history to the cap', () => {
      const searches = Array.from({ length: MAX_SEARCH_HISTORY + 10 }, (_, index) =>
        makeSearch({ query: `q${index}`, daysAgo: index }),
      )
      const { state } = sanitizeState({ version: 1, searchHistory: searches }, NOW)
      expect(state.searchHistory).toHaveLength(MAX_SEARCH_HISTORY)
      expect(state.searchHistory[0].query).toBe('q0')
    })
  })

  describe('versioning', () => {
    it('accepts the current version', () => {
      expect(migrate({ version: PERSONALIZATION_VERSION }).kind).toBe('ok')
    })

    it('refuses a payload from a newer build rather than reinterpreting it', () => {
      const outcome = migrate({ version: PERSONALIZATION_VERSION + 5, listeningHistory: [] })
      expect(outcome).toEqual({ kind: 'incompatible', foundVersion: PERSONALIZATION_VERSION + 5 })
    })

    it('leaves an incompatible payload on disk untouched', () => {
      const storage = memoryStorage()
      const future = JSON.stringify({ version: 99, listeningHistory: [{ keep: 'me' }] })
      storage.setItem(PERSONALIZATION_STORAGE_KEY, future)

      const { state, status } = readState(storage, NOW)
      expect(status).toBe('incompatible')
      expect(state.listeningHistory).toEqual([])
      expect(storage.getItem(PERSONALIZATION_STORAGE_KEY)).toBe(future)
    })

    it('treats a missing or nonsense version as unusable', () => {
      expect(migrate({ listeningHistory: [] }).kind).toBe('unusable')
      expect(migrate({ version: 'one' }).kind).toBe('unusable')
      expect(migrate([1, 2, 3]).kind).toBe('unusable')
      expect(migrate(null).kind).toBe('unusable')
    })
  })

  describe('storage unavailable', () => {
    it('reports unavailable rather than throwing when there is no storage', () => {
      const { state, status } = readState(null, NOW)
      expect(status).toBe('unavailable')
      expect(state.listeningHistory).toEqual([])
      expect(writeState(makeState(), null)).toBe('unavailable')
      expect(isStorageAvailable(null)).toBe(false)
    })

    it('survives a quota-exceeded write', () => {
      const storage = failingStorage()
      expect(() => writeState(makeState(), storage)).not.toThrow()
      expect(writeState(makeState(), storage)).toBe('unavailable')
      expect(isStorageAvailable(storage)).toBe(false)
    })

    it('clearing is a no-op when storage is gone', () => {
      expect(() => clearStoredState(null)).not.toThrow()
    })
  })

  describe('the persisted shape is an allow-list (STEP 21)', () => {
    const FORBIDDEN = [
      'apikey',
      'key',
      'token',
      'authorization',
      'streamurl',
      'clientsecret',
      'youtube_api_key',
      'jamendo_client_id',
      'password',
      'secret',
      'bearer',
    ]

    /** Every key at every depth of the persisted object. */
    function allKeys(value: unknown, found: string[] = []): string[] {
      if (Array.isArray(value)) {
        for (const item of value) allKeys(item, found)
        return found
      }
      if (typeof value === 'object' && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          found.push(key)
          allKeys(child, found)
        }
      }
      return found
    }

    it('persists no forbidden field name, at any depth', () => {
      const state = makeState({
        listeningHistory: [
          makeEntry({ id: 'a' }),
          makeEntry({ id: 'b', provider: 'jamendo' }),
          makeEntry({ id: 'c', provider: 'youtube' }),
        ],
        searchHistory: [makeSearch({ query: 'anything' })],
      })

      const keys = allKeys(toPersisted(state)).map((key) => key.toLowerCase())
      for (const forbidden of FORBIDDEN) {
        expect(keys, `persisted a "${forbidden}" field`).not.toContain(forbidden)
      }
    })

    it('does not persist a credential smuggled onto a history row', () => {
      const state = makeState({
        listeningHistory: [
          {
            ...makeEntry({ id: 'a' }),
            // Simulates a provider payload widening, or a caller spreading an
            // object it should not have.
            streamUrl: 'https://cdn.example/secret-signed-url',
            apiKey: 'AIzaSyDEADBEEF',
            token: 'ya29.a0AfH6',
          } as never,
        ],
      })

      const serialized = JSON.stringify(toPersisted(state))
      expect(serialized).not.toContain('secret-signed-url')
      expect(serialized).not.toContain('AIzaSyDEADBEEF')
      expect(serialized).not.toContain('ya29.a0AfH6')
    })

    it('writes the same allow-listed shape to real storage', () => {
      const storage = memoryStorage()
      writeState(
        makeState({
          listeningHistory: [
            { ...makeEntry({ id: 'a' }), streamUrl: 'https://cdn.example/leak' } as never,
          ],
        }),
        storage,
      )
      const raw = storage.getItem(PERSONALIZATION_STORAGE_KEY) ?? ''
      expect(raw).not.toContain('streamUrl')
      expect(raw).not.toContain('leak')
    })

    it('never persists YouTube statistics, even if a row carries them', () => {
      const state = makeState({
        listeningHistory: [
          {
            ...makeEntry({ id: 'vid', provider: 'youtube' }),
            viewCount: 1_000_000,
            likeCount: 5000,
            statistics: { viewCount: 1 },
          } as never,
        ],
      })
      const serialized = JSON.stringify(toPersisted(state))
      expect(serialized).not.toContain('viewCount')
      expect(serialized).not.toContain('likeCount')
      expect(serialized).not.toContain('statistics')
    })
  })
})
