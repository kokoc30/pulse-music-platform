import { beforeEach, describe, expect, it } from 'vitest'
import { createAudiusProvider } from '@/music/audius/adapter'
import { setMusicProvider } from '@/music/provider'
import type { Track } from '@/music/types'
import { resetPersonalizationForTests } from '@/personalization'
import { setAudioEngine } from './audio-engine'
import { clearAutoplayBuffer, clearSessionPool, planAutoplay, rememberTracks } from './autoplay'
import type { Candidate } from './autoplay'
import { createFakeAudioEngine } from './fake-audio-engine'
import type { FakeAudioEngine } from './fake-audio-engine'
import { resetPlaybackCoordinator } from './playback-coordinator'
import { addToQueue, playNext, resetMediaRetries } from './player-actions'
import { initialPlayerState, usePlayerStore } from './player-store'

/**
 * Seed playback: what happens after a *single chosen song* finishes.
 *
 * The bug this covers was a semantic one rather than a broken function. Clicking
 * a search row turned the whole result list into the explicit queue, and since
 * the queue outranks everything generated, Phase 6 autoplay was never reached —
 * "autoplay" in practice meant "play the search rows in order", which is how a
 * second upload of the same song ended up playing next.
 */

let engine: FakeAudioEngine
let counter = 0

function track(overrides: Partial<Track> = {}): Track {
  counter += 1
  const providerId = overrides.providerId ?? `t${counter}`
  return {
    id: `jamendo:${providerId}`,
    mediaKind: 'audio',
    provider: 'jamendo',
    providerId,
    title: `Track ${providerId}`,
    artistName: `Artist ${counter}`,
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    genre: 'Hip-Hop',
    streamUrl: 'https://prod.jamendo.test/stream.mp3',
    ...overrides,
    ...(overrides.id ? { id: overrides.id } : {}),
  }
}

/** What `playSeedTrack` establishes: a one-track queue and nothing else. */
function seat(seed: Track) {
  const state = usePlayerStore.getState()
  state.setQueue([seed], 0, { id: 'search:kosandra', label: '“kosandra”' })
  state.setStatus('playing')
}

const currentTitle = () => usePlayerStore.getState().currentTrack?.title

beforeEach(() => {
  counter = 0
  setMusicProvider(createAudiusProvider())
  engine = createFakeAudioEngine()
  setAudioEngine(engine)
  usePlayerStore.setState({ ...initialPlayerState, autoplaySimilar: true })
  resetMediaRetries()
  resetPlaybackCoordinator()
  resetPersonalizationForTests()
  clearAutoplayBuffer()
  clearSessionPool()
})

describe('a seed with nothing queued behind it reaches autoplay', () => {
  it('plays a similar track rather than stopping', async () => {
    const seed = track({ providerId: 'seed', title: 'Kosandra', artistName: 'Miyagi & Andy Panda' })
    const similar = track({ providerId: 'similar', title: 'Utopia', artistName: 'Miyagi & Andy Panda' })
    rememberTracks([similar])
    seat(seed)

    await playNext()

    expect(currentTitle()).toBe('Utopia')
  })

  it('does not pick a sibling merely because it was the next search row', async () => {
    // Both are in the session pool exactly as a search would have left them.
    const seed = track({ providerId: 'seed', title: 'Kosandra', artistName: 'Miyagi & Andy Panda' })
    const cosmetic = track({
      providerId: 'dupe',
      title: 'Kosandra (Official Audio)',
      artistName: 'Miyagi & Andy Panda',
    })
    const different = track({ providerId: 'other', title: 'Utopia', artistName: 'Miyagi & Andy Panda' })
    rememberTracks([cosmetic, different])
    seat(seed)

    await playNext()

    expect(currentTitle()).toBe('Utopia')
    expect(currentTitle()).not.toBe('Kosandra (Official Audio)')
  })

  it('stops cleanly when autoplay is off, rather than replaying the results', async () => {
    usePlayerStore.setState({ autoplaySimilar: false })
    rememberTracks([track({ providerId: 'other' })])
    seat(track({ providerId: 'seed' }))

    await playNext()

    expect(usePlayerStore.getState().status).toBe('paused')
    expect(currentTitle()).toBe('Track seed')
  })
})

describe('an explicitly queued track still wins', () => {
  it('plays the queued track before any generated candidate', async () => {
    const seed = track({ providerId: 'seed', title: 'Kosandra' })
    const queued = track({ providerId: 'queued', title: 'Chosen By Hand' })
    const generated = track({ providerId: 'generated', title: 'Generated' })
    rememberTracks([generated])
    seat(seed)

    addToQueue(queued)
    expect(usePlayerStore.getState().queue).toHaveLength(2)

    await playNext()
    expect(currentTitle()).toBe('Chosen By Hand')
  })

  it('reaches autoplay only once the manual queue is exhausted', async () => {
    const seed = track({ providerId: 'seed', title: 'Kosandra' })
    const queued = track({ providerId: 'queued', title: 'Chosen By Hand' })
    const generated = track({ providerId: 'generated', title: 'Generated' })
    rememberTracks([generated])
    seat(seed)
    addToQueue(queued)

    await playNext()
    expect(currentTitle()).toBe('Chosen By Hand')

    await playNext()
    expect(currentTitle()).toBe('Generated')
  })
})

describe('a collection keeps sequential queue semantics', () => {
  it('plays the next item of a playlist rather than a generated one', async () => {
    const a = track({ providerId: 'a', title: 'A' })
    const b = track({ providerId: 'b', title: 'B' })
    const c = track({ providerId: 'c', title: 'C' })
    rememberTracks([track({ providerId: 'generated', title: 'Generated' })])

    const state = usePlayerStore.getState()
    state.setQueue([a, b, c], 0, { id: 'playlist:x', label: 'Road Trip' })
    state.setStatus('playing')

    await playNext()
    expect(currentTitle()).toBe('B')
    await playNext()
    expect(currentTitle()).toBe('C')
  })

  it('reaches autoplay only at the end of the collection', async () => {
    const a = track({ providerId: 'a', title: 'A' })
    const b = track({ providerId: 'b', title: 'B' })
    rememberTracks([track({ providerId: 'generated', title: 'Generated' })])

    const state = usePlayerStore.getState()
    state.setQueue([a, b], 1, { id: 'playlist:x', label: 'Road Trip' })
    state.setStatus('playing')

    await playNext()
    expect(currentTitle()).toBe('Generated')
  })
})

describe('the planner refuses cosmetic duplicates of the seed', () => {
  const candidate = (overrides: Partial<Track>): Candidate => ({
    track: track(overrides),
    source: 'session',
  })

  const seed = () =>
    track({ providerId: 'seed', title: 'Kosandra', artistName: 'Miyagi & Andy Panda' })

  it('skips every cosmetic version and picks a genuinely different song', () => {
    const plan = planAutoplay({
      seed: seed(),
      candidates: [
        candidate({ providerId: 'd1', title: 'Kosandra (Official Audio)', artistName: 'Miyagi & Andy Panda' }),
        candidate({ providerId: 'd2', title: 'Kosandra Lyrics', artistName: 'Miyagi & Andy Panda' }),
        candidate({ providerId: 'd3', title: 'Kosandra (Remastered)', artistName: 'Miyagi & Andy Panda' }),
        candidate({ providerId: 'ok', title: 'Another Song', artistName: 'Miyagi & Andy Panda' }),
      ],
      queuedIds: [],
      recentIds: [],
      size: 4,
    })

    expect(plan.map((item) => item.track.title)).toEqual(['Another Song'])
  })

  it('still allows a different artist with the same title', () => {
    const plan = planAutoplay({
      seed: seed(),
      candidates: [candidate({ providerId: 'x', title: 'Kosandra', artistName: 'Another Artist' })],
      queuedIds: [],
      recentIds: [],
      size: 1,
    })

    expect(plan).toHaveLength(1)
    expect(plan[0].track.artistName).toBe('Another Artist')
  })

  it('still allows a genuinely different take of the same song', () => {
    const plan = planAutoplay({
      seed: seed(),
      candidates: [
        candidate({ providerId: 'r', title: 'Kosandra (Remix)', artistName: 'Miyagi & Andy Panda' }),
      ],
      queuedIds: [],
      recentIds: [],
      size: 1,
    })

    expect(plan.map((item) => item.track.title)).toEqual(['Kosandra (Remix)'])
  })

  it('never puts two cosmetic versions of one song in the same run', () => {
    const plan = planAutoplay({
      seed: track({ providerId: 'seed', title: 'Unrelated Seed', artistName: 'Someone Else' }),
      candidates: [
        candidate({ providerId: 'a1', title: 'Shared Song', artistName: 'Band' }),
        candidate({ providerId: 'a2', title: 'Shared Song (Official Audio)', artistName: 'Band' }),
        candidate({ providerId: 'b1', title: 'Other Song', artistName: 'Another Band' }),
      ],
      queuedIds: [],
      recentIds: [],
      size: 3,
    })

    const titles = plan.map((item) => item.track.title)
    expect(titles).toContain('Shared Song')
    expect(titles).not.toContain('Shared Song (Official Audio)')
  })

  it('returns nothing rather than a duplicate when only duplicates remain', () => {
    const plan = planAutoplay({
      seed: seed(),
      candidates: [
        candidate({ providerId: 'd1', title: 'Kosandra (Official Audio)', artistName: 'Miyagi & Andy Panda' }),
      ],
      queuedIds: [],
      recentIds: [],
      size: 1,
    })

    // Better to stop than to follow a song with another upload of itself.
    expect(plan).toEqual([])
  })
})
