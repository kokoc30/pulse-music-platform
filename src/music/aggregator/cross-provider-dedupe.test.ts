import { describe, expect, it } from 'vitest'
import type { ScoredTrack } from '@/music/search/relevance'
import type { ProviderId, Track } from '@/music/types'
import { dedupeAcrossProviders, isSameRecording, pickWinner, versionMarkers } from './cross-provider-dedupe'

function track(provider: ProviderId, id: string, overrides: Partial<Track> = {}): Track {
  return {
    id: `${provider}:${id}`,
    mediaKind: 'audio',
    provider,
    providerId: id,
    title: 'Reverie',
    artistName: 'Lumen Field',
    artwork: { small: 'https://cdn.test/a.jpg', medium: 'https://cdn.test/a.jpg' },
    durationSeconds: 214,
    isStreamable: true,
    ...overrides,
  }
}

function scored(item: Track, score: number): ScoredTrack {
  return {
    track: item,
    relevance: { score, title: score, artist: score, popularity: 0, coverage: 1 },
    matchedQuery: 'reverie',
  }
}

describe('cross-provider duplicate detection', () => {
  it('merges the same recording found on both catalogues', () => {
    expect(isSameRecording(track('audius', 'a1'), track('jamendo', 'j1'))).toBe(true)
  })

  it('ignores decoration that says nothing about which recording this is', () => {
    const a = track('audius', 'a1', { title: 'Reverie (Official Audio)' })
    const b = track('jamendo', 'j1', { title: 'Reverie' })
    expect(isSameRecording(a, b)).toBe(true)
  })

  it('keeps a remix separate from the original', () => {
    const a = track('audius', 'a1', { title: 'Reverie' })
    const b = track('jamendo', 'j1', { title: 'Reverie (Sunset Remix)' })
    expect(isSameRecording(a, b)).toBe(false)
  })

  it('keeps a live take separate', () => {
    const a = track('audius', 'a1', { title: 'Reverie' })
    const b = track('jamendo', 'j1', { title: 'Reverie (Live)' })
    expect(isSameRecording(a, b)).toBe(false)
  })

  it('keeps an acoustic version separate', () => {
    const a = track('audius', 'a1', { title: 'Reverie' })
    const b = track('jamendo', 'j1', { title: 'Reverie - Acoustic' })
    expect(isSameRecording(a, b)).toBe(false)
  })

  it('keeps an instrumental and a karaoke cut separate', () => {
    for (const title of ['Reverie (Instrumental)', 'Reverie [Karaoke]', 'Reverie - Radio Edit']) {
      expect(isSameRecording(track('audius', 'a1'), track('jamendo', 'j1', { title }))).toBe(false)
    }
  })

  it('keeps a cover by a different artist separate', () => {
    const a = track('audius', 'a1', { artistName: 'Lumen Field' })
    const b = track('jamendo', 'j1', { artistName: 'Paper Kites' })
    expect(isSameRecording(a, b)).toBe(false)
  })

  it('keeps a different song with the same artist separate', () => {
    const a = track('audius', 'a1', { title: 'Reverie' })
    const b = track('jamendo', 'j1', { title: 'Slow Country' })
    expect(isSameRecording(a, b)).toBe(false)
  })

  it('keeps two recordings of materially different length separate', () => {
    const a = track('audius', 'a1', { durationSeconds: 214 })
    const b = track('jamendo', 'j1', { durationSeconds: 260 })
    expect(isSameRecording(a, b)).toBe(false)
    // A couple of seconds of mastering drift is still the same master.
    expect(isSameRecording(a, track('jamendo', 'j2', { durationSeconds: 216 }))).toBe(true)
  })

  it('refuses to merge when a duration is unknown', () => {
    const a = track('audius', 'a1', { durationSeconds: 0 })
    expect(isSameRecording(a, track('jamendo', 'j1'))).toBe(false)
  })

  it('never merges two tracks from the same provider', () => {
    // Within a provider, two rows with the same title really are two releases.
    expect(isSameRecording(track('jamendo', 'j1'), track('jamendo', 'j2'))).toBe(false)
  })

  it('recognises the version markers that block a merge', () => {
    expect(versionMarkers('Reverie (Sunset Remix)')).toEqual(['remix'])
    expect(versionMarkers('Reverie - Live Acoustic')).toEqual(['acoustic', 'live'])
    expect(versionMarkers('Reverie (Official Audio)')).toEqual([])
  })
})

describe('duplicate winner selection', () => {
  it('prefers the higher relevance', () => {
    const a = scored(track('audius', 'a1'), 0.9)
    const b = scored(track('jamendo', 'j1'), 0.7)
    expect(pickWinner(a, b).track.id).toBe('audius:a1')
    expect(pickWinner(b, a).track.id).toBe('audius:a1')
  })

  it('prefers a playable row over an equally relevant unplayable one', () => {
    const a = scored(track('audius', 'a1', { isStreamable: false }), 0.8)
    const b = scored(track('jamendo', 'j1', { isStreamable: true }), 0.8)
    expect(pickWinner(a, b).track.id).toBe('jamendo:j1')
  })

  it('prefers the row that actually has artwork', () => {
    const a = scored(track('audius', 'a1', { artwork: {} }), 0.8)
    const b = scored(track('jamendo', 'j1'), 0.8)
    expect(pickWinner(a, b).track.id).toBe('jamendo:j1')
  })

  it('is deterministic and provider-neutral when everything else ties', () => {
    const a = scored(track('audius', 'a1'), 0.8)
    const b = scored(track('jamendo', 'j1'), 0.8)
    expect(pickWinner(a, b).track.id).toBe(pickWinner(b, a).track.id)
  })
})

describe('dedupe over a ranked list', () => {
  it('collapses a duplicate and keeps the best position it earned', () => {
    const ranked = [
      scored(track('audius', 'a1'), 0.95),
      scored(track('jamendo', 'j1'), 0.9),
      scored(track('jamendo', 'j2', { title: 'Slow Country' }), 0.6),
    ]
    const { tracks, merged } = dedupeAcrossProviders(ranked)
    expect(merged).toBe(1)
    expect(tracks.map((item) => item.track.id)).toEqual(['audius:a1', 'jamendo:j2'])
  })

  it('leaves a distinct recording visible rather than guessing', () => {
    const ranked = [
      scored(track('audius', 'a1', { title: 'Reverie' }), 0.95),
      scored(track('jamendo', 'j1', { title: 'Reverie (Live)' }), 0.9),
    ]
    const { tracks, merged } = dedupeAcrossProviders(ranked)
    expect(merged).toBe(0)
    expect(tracks).toHaveLength(2)
  })

  it('is a no-op on an empty or single-item list', () => {
    expect(dedupeAcrossProviders([]).tracks).toEqual([])
    expect(dedupeAcrossProviders([scored(track('audius', 'a1'), 1)]).tracks).toHaveLength(1)
  })
})
