import { describe, expect, it } from 'vitest'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { audiusTrack, jamendoTrackFixture } from '@/test/fixtures/library'
import { youtubePayload } from '@/test/fixtures/youtube'
import type { PlayerStatus } from './player-store'
import { initialPlayerState } from './player-store'
import { mapAudioStatus, mapYouTubeStatus } from './types'
import type { UnifiedStatus } from './types'
import { selectSnapshotState } from './use-playback-snapshot'
import type { SnapshotInput } from './use-playback-snapshot'
import type { YouTubeStatus } from './youtube-store'
import { initialYouTubeState } from './youtube-store'

/**
 * The read model both surfaces are built on.
 *
 * These are the tests that make "no component branches on the engine" a real
 * guarantee rather than a convention: everything a bar or a sheet needs to draw
 * itself has to be answerable *here*, from either store, without the caller
 * knowing which one it came from.
 */

const VIDEO = normalizeYouTubeVideo(
  youtubePayload({
    videoId: 'aram0000001',
    title: 'Sourp Sarkis',
    channelTitle: 'Aram Asatryan - Topic',
    durationSeconds: 240,
  }),
)

const OTHER = normalizeYouTubeVideo(
  youtubePayload({ videoId: 'aram0000002', title: 'Barov Ari' }),
)

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    engine: 'none',
    audio: initialPlayerState,
    youtube: initialYouTubeState,
    ...overrides,
  }
}

const withVideo = (overrides: Partial<typeof initialYouTubeState> = {}) =>
  input({ engine: 'youtube', youtube: { ...initialYouTubeState, item: VIDEO, ...overrides } })

const withTrack = (track = audiusTrack(), overrides: Partial<typeof initialPlayerState> = {}) =>
  input({ engine: 'audio', audio: { ...initialPlayerState, currentTrack: track, ...overrides } })

describe('status mapping', () => {
  const AUDIO_CASES: [PlayerStatus, UnifiedStatus][] = [
    ['idle', 'idle'],
    ['loading', 'buffering'],
    ['playing', 'playing'],
    ['paused', 'paused'],
    // Still loaded, and a press re-resolves the stream, so the honest control
    // is an enabled Play button.
    ['error', 'paused'],
  ]

  it.each(AUDIO_CASES)('maps audio %s to %s', (from, to) => {
    expect(mapAudioStatus(from)).toBe(to)
  })

  const YOUTUBE_CASES: [YouTubeStatus, UnifiedStatus][] = [
    ['idle', 'idle'],
    ['loading', 'buffering'],
    // Not busy — this is the policy-mandated "waiting for an explicit press"
    // state, and rendering it as buffering would disable the very control the
    // Required Minimum Functionality rule exists to insist on.
    ['cued', 'paused'],
    ['playing', 'playing'],
    ['paused', 'paused'],
    ['ended', 'ended'],
    ['error', 'paused'],
  ]

  it.each(YOUTUBE_CASES)('maps YouTube %s to %s', (from, to) => {
    expect(mapYouTubeStatus(from)).toBe(to)
  })

  it('covers every member of both source enums', () => {
    // The mappers are exhaustive switches, so a new member would fail to
    // compile — but a member removed from a case list would go untested
    // silently. These counts are the guard against that.
    expect(AUDIO_CASES).toHaveLength(5)
    expect(YOUTUBE_CASES).toHaveLength(7)
  })
})

describe('capabilities', () => {
  it('offers an audio track everything', () => {
    expect(selectSnapshotState(withTrack()).capabilities).toEqual({
      seek: true,
      like: true,
      shuffle: true,
      repeat: true,
      volume: true,
      queue: true,
      expand: true,
      continuous: false,
      // An audio track is dismissed by playing something else, or by the queue
      // ending. There is nothing to close.
      dismiss: false,
    })
  })

  it('offers a video exactly what it can honestly do', () => {
    expect(selectSnapshotState(withVideo()).capabilities).toEqual({
      // Real: the IFrame API publishes `seekTo`.
      seek: true,
      // Real: the library already keys YouTube references.
      like: true,
      // Not real: a result session has no running order, and no audio queue.
      shuffle: false,
      repeat: false,
      queue: false,
      // Not ours to set — native controls own the embed's volume.
      volume: false,
      expand: true,
      // The video's own equivalent of autoplay-similar.
      continuous: true,
      // And the way back to the audio track preserved underneath.
      dismiss: true,
    })
  })

  it('offers nothing at all when nothing is loaded', () => {
    const snapshot = selectSnapshotState(input())
    expect(Object.values(snapshot.capabilities).every((value) => value === false)).toBe(true)
  })
})

describe('the embedded stage', () => {
  it('is false for audio, and carries no stage item', () => {
    const snapshot = selectSnapshotState(withTrack())
    expect(snapshot.isEmbeddedStage).toBe(false)
    expect(snapshot.stageItem).toBeNull()
  })

  it('is true for a video, and carries the item to host', () => {
    const snapshot = selectSnapshotState(withVideo())
    expect(snapshot.isEmbeddedStage).toBe(true)
    expect(snapshot.stageItem).toBe(VIDEO)
    expect(snapshot.artworkAspect).toBe('16:9')
  })
})

describe('engine precedence', () => {
  it('returns a neutral snapshot when neither engine has anything', () => {
    const snapshot = selectSnapshotState(input())
    expect(snapshot.engine).toBe('none')
    expect(snapshot.title).toBe('')
    expect(snapshot.toLibraryRef).toBeNull()
  })

  it('shows the video while YouTube holds the claim, not the loaded track', () => {
    const snapshot = selectSnapshotState({
      engine: 'youtube',
      audio: { ...initialPlayerState, currentTrack: audiusTrack() },
      youtube: { ...initialYouTubeState, item: VIDEO },
    })
    expect(snapshot.engine).toBe('youtube')
    expect(snapshot.title).toBe('Sourp Sarkis')
  })

  /**
   * The regression this exists to prevent: closing a video releases the claim to
   * `'none'`, and the audio track it paused is still loaded underneath —
   * `activateYouTube` preserves it on purpose. Requiring `engine === 'audio'`
   * dropped the visitor to the join strip at exactly that moment.
   */
  it('keeps showing a loaded audio track after the claim is released', () => {
    const snapshot = selectSnapshotState({
      engine: 'none',
      audio: { ...initialPlayerState, currentTrack: audiusTrack(), status: 'paused' },
      youtube: initialYouTubeState,
    })
    expect(snapshot.engine).toBe('audio')
    expect(snapshot.title).toBe('Neon Corridor')
    expect(snapshot.status).toBe('paused')
  })

  it('falls back to nothing when YouTube holds the claim with no item', () => {
    expect(selectSnapshotState(input({ engine: 'youtube' })).engine).toBe('none')
  })
})

describe('attribution and identity', () => {
  it('marks a Jamendo track as requiring its backlink', () => {
    const snapshot = selectSnapshotState(withTrack(jamendoTrackFixture()))
    expect(snapshot.attributionRequired).toBe(true)
    expect(snapshot.providerLabel).toBe('Jamendo')
    expect(snapshot.sourceUrl).toContain('jamendo.com')
  })

  it('leaves an Audius track unattributed, with its permalink as a convenience', () => {
    const snapshot = selectSnapshotState(withTrack())
    expect(snapshot.attributionRequired).toBe(false)
    expect(snapshot.providerLabel).toBe('Audius')
    expect(snapshot.sourceUrl).toBe('https://audius.co/astervale/t1')
  })

  it('marks a video as requiring its watch-page link', () => {
    const snapshot = selectSnapshotState(withVideo())
    expect(snapshot.attributionRequired).toBe(true)
    expect(snapshot.providerLabel).toBe('YouTube')
    expect(snapshot.sourceUrl).toContain('youtube.com/watch')
  })

  it('builds a library reference keyed the way the rows key theirs', () => {
    expect(selectSnapshotState(withTrack()).toLibraryRef?.().key).toBe('audius:t1')
    expect(selectSnapshotState(withVideo()).toLibraryRef?.().key).toBe('youtube:aram0000001')
  })

  it('keeps the artwork object, mirrors included, for audio failover', () => {
    const snapshot = selectSnapshotState(withTrack())
    expect(snapshot.artwork?.mirrors).toEqual(['https://mirror.example'])
  })

  it('offers a video no queueable track, so Add to queue cannot be shown', () => {
    expect(selectSnapshotState(withVideo()).queueableTrack).toBeNull()
    expect(selectSnapshotState(withTrack()).queueableTrack?.id).toBe('audius:t1')
  })
})

describe('transport availability', () => {
  it('lets a video step only where its session actually reaches', () => {
    const standalone = selectSnapshotState(withVideo())
    expect(standalone.canNext).toBe(false)
    expect(standalone.canPrevious).toBe(false)

    const inSession = selectSnapshotState(
      withVideo({ sessionItems: [VIDEO, OTHER], sessionIndex: 0 }),
    )
    expect(inSession.canNext).toBe(true)
    expect(inSession.canPrevious).toBe(false)
  })

  it('reads audio Next through the same predicate the audio bar uses', () => {
    // A one-track queue with autoplay on: no further position, but a seed to
    // generate from — the exact case that used to grey the control out.
    const snapshot = selectSnapshotState(
      withTrack(audiusTrack(), { queue: [audiusTrack()], currentIndex: 0, autoplaySimilar: true }),
    )
    expect(snapshot.canNext).toBe(true)

    const noAutoplay = selectSnapshotState(
      withTrack(audiusTrack(), { queue: [audiusTrack()], currentIndex: 0, autoplaySimilar: false }),
    )
    expect(noAutoplay.canNext).toBe(false)
  })

  it('falls back to the item duration until the embed reports one', () => {
    expect(selectSnapshotState(withVideo()).duration).toBe(240)
    expect(selectSnapshotState(withVideo({ duration: 213 })).duration).toBe(213)
  })
})
