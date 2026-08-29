import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { initialPlayerState } from '@/player/player-store'
import { selectSnapshotState } from '@/player/use-playback-snapshot'
import type { PlaybackSnapshot } from '@/player/use-playback-snapshot'
import { initialYouTubeState } from '@/player/youtube-store'
import { audiusTrack, jamendoTrackFixture } from '@/test/fixtures/library'
import { youtubePayload } from '@/test/fixtures/youtube'
import { PlayerBar } from './PlayerBar'

/**
 * The one bottom bar.
 *
 * The claim under test is the one the whole refactor exists for: an Audius
 * track, a Jamendo track and a YouTube video reach this component through the
 * same props and come out as the same DOM tree, differing only where they
 * genuinely must. So most of these tests are the *same assertion* run against
 * two snapshots.
 */

const VIDEO = normalizeYouTubeVideo(
  youtubePayload({
    videoId: 'aram0000001',
    title: 'Sourp Sarkis',
    channelTitle: 'Aram Asatryan - Topic',
    durationSeconds: 240,
  }),
)

function audioSnapshot(track = audiusTrack(), overrides: Partial<typeof initialPlayerState> = {}) {
  return selectSnapshotState({
    engine: 'audio',
    audio: { ...initialPlayerState, currentTrack: track, status: 'playing', ...overrides },
    youtube: initialYouTubeState,
  })
}

function videoSnapshot(overrides: Partial<typeof initialYouTubeState> = {}) {
  return selectSnapshotState({
    engine: 'audio' in overrides ? 'audio' : 'youtube',
    audio: initialPlayerState,
    youtube: { ...initialYouTubeState, item: VIDEO, status: 'playing', ...overrides },
  })
}

const renderBar = (snapshot: PlaybackSnapshot) => render(<PlayerBar snapshot={snapshot} />)
const bar = () => screen.getByRole('region', { name: 'Now playing' })

describe('nothing loaded', () => {
  it('renders nothing at all', () => {
    const { container } = renderBar(
      selectSnapshotState({
        engine: 'none',
        audio: initialPlayerState,
        youtube: initialYouTubeState,
      }),
    )
    expect(container).toBeEmptyDOMElement()
  })
})

/**
 * The bar is the same bar for every provider — same slot, same element, same
 * size. The live player is not here at all: it belongs to the expanded sheet,
 * and the bar shows YouTube's own thumbnail like any other cover.
 */
describe('the artwork slot', () => {
  it('holds a still image for a catalogue track', () => {
    const { container } = renderBar(audioSnapshot())
    const img = container.querySelector('.player-track img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'https://art.example/t1.jpg')
  })

  it('holds YouTube’s own thumbnail for a video — no iframe, no reserved box', () => {
    const { container } = renderBar(videoSnapshot())
    const img = container.querySelector('.player-track img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'https://i.ytimg.com/vi/aram0000001/mqdefault.jpg')

    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('[data-testid="youtube-stage"]')).toBeNull()
  })

  it('renders the identical DOM shape whichever provider is playing', () => {
    const shapeOf = (snapshot: PlaybackSnapshot) => {
      const { container, unmount } = renderBar(snapshot)
      const shape = [...container.querySelectorAll<HTMLElement>('.player-track > *')].map(
        (node) => `${node.tagName}.${node.className}`,
      )
      unmount()
      return shape
    }

    // Same children, in the same order, with the same classes. The only thing
    // that differs between an Audius track and a YouTube video in this bar is
    // the text and the image URL.
    expect(shapeOf(videoSnapshot())).toEqual(shapeOf(audioSnapshot(jamendoTrackFixture())))
  })

  it('adds no height-changing marker for a video', () => {
    const { container } = renderBar(videoSnapshot())
    const section = container.querySelector<HTMLElement>('.music-player')!
    // The bar must not be able to style itself taller for one provider.
    expect(section.getAttribute('data-stage')).toBeNull()
    expect(section.className).toBe('music-player')
  })
})

describe('what every provider gets', () => {
  const CASES: [string, () => PlaybackSnapshot][] = [
    ['an Audius track', () => audioSnapshot()],
    ['a Jamendo track', () => audioSnapshot(jamendoTrackFixture())],
    ['a YouTube video', () => videoSnapshot()],
  ]

  it.each(CASES)('gives %s a title, a subtitle and a source credit', (_name, make) => {
    const snapshot = make()
    renderBar(snapshot)
    expect(within(bar()).getByText(snapshot.title)).toBeInTheDocument()
    expect(within(bar()).getByText(snapshot.subtitle)).toBeInTheDocument()
    expect(within(bar()).getByText(snapshot.providerLabel)).toBeInTheDocument()
  })

  it.each(CASES)('gives %s the same transport', (_name, make) => {
    renderBar(make())
    for (const name of ['Previous track', 'Pause', 'Next track']) {
      expect(within(bar()).getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it.each(CASES)('gives %s a live seek rail', (_name, make) => {
    renderBar(make())
    expect(within(bar()).getByRole('slider', { name: 'Seek' })).toBeInTheDocument()
  })

  it.each(CASES)('gives %s a heart', (_name, make) => {
    renderBar(make())
    expect(
      within(bar()).getByRole('button', { name: /Save .+ to Liked Songs in Pulse/i }),
    ).toBeInTheDocument()
  })

  it.each(CASES)('gives %s the expand affordance', (_name, make) => {
    renderBar(make())
    expect(within(bar()).getByRole('button', { name: 'Open Now Playing' })).toBeInTheDocument()
  })
})

describe('what only an audio queue gets', () => {
  it('shows shuffle, repeat and volume for a track', () => {
    renderBar(audioSnapshot())
    expect(within(bar()).getByRole('button', { name: /Shuffle/i })).toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: /Repeat/i })).toBeInTheDocument()
    expect(within(bar()).getByRole('slider', { name: 'Volume' })).toBeInTheDocument()
  })

  it('omits them entirely for a video, rather than disabling them', () => {
    renderBar(videoSnapshot())
    expect(within(bar()).queryByRole('button', { name: /Shuffle/i })).not.toBeInTheDocument()
    expect(within(bar()).queryByRole('button', { name: /Repeat/i })).not.toBeInTheDocument()
    expect(within(bar()).queryByRole('slider', { name: 'Volume' })).not.toBeInTheDocument()
  })
})

/**
 * These assertions replace the file-level `noreferrer` scan that the unified
 * component made imprecise. A static string search cannot tell which branch
 * emitted an attribute; the rendered DOM can, and this is the guarantee that
 * actually matters.
 */
describe('source attribution, per provider rules', () => {
  it('gives a Jamendo track exactly one anchor, on the credit itself', () => {
    renderBar(audioSnapshot(jamendoTrackFixture()))
    const links = within(bar()).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute(
      'href',
      'https://www.jamendo.com/track/1880336/night-reverie',
    )
    // Jamendo has no referrer requirement, so the safest rel applies.
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('never suppresses the referrer on a YouTube link', () => {
    renderBar(videoSnapshot())
    const link = within(bar()).getByRole('link')
    expect(link).toHaveAttribute('href', expect.stringContaining('youtube.com/watch'))
    // Required Minimum Functionality: an API client "must not use the
    // noreferrer feature".
    expect(link.getAttribute('rel')).toBe('noopener')
    expect(link.getAttribute('rel')).not.toContain('noreferrer')
  })

  it('leaves an Audius permalink as a plain convenience link', () => {
    renderBar(audioSnapshot())
    const link = within(bar()).getByRole('link', { name: /Open Neon Corridor on Audius/i })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // The credit beside the artist is text, not an anchor: Audius requires none.
    expect(within(bar()).getByText('Audius').tagName).toBe('SPAN')
  })
})

describe('transport enablement follows the snapshot', () => {
  it('disables Next when the snapshot says there is nowhere to go', () => {
    renderBar(videoSnapshot())
    expect(within(bar()).getByRole('button', { name: 'Next track' })).toBeDisabled()
  })

  it('enables Next when the session reaches further', () => {
    const second = normalizeYouTubeVideo(youtubePayload({ videoId: 'aram0000002' }))
    renderBar(videoSnapshot({ sessionItems: [VIDEO, second], sessionIndex: 0 }))
    expect(within(bar()).getByRole('button', { name: 'Next track' })).toBeEnabled()
  })

  it('shows a spinner and blocks the press while buffering', () => {
    renderBar(videoSnapshot({ status: 'loading' }))
    // 'Play', because buffering is not playing — and disabled, because the
    // press would reach a player that is not ready.
    expect(within(bar()).getByRole('button', { name: 'Play' })).toBeDisabled()
  })

  it('leaves a cued video pressable, because it is waiting for exactly that', () => {
    renderBar(videoSnapshot({ status: 'cued' }))
    expect(within(bar()).getByRole('button', { name: 'Play' })).toBeEnabled()
  })
})
