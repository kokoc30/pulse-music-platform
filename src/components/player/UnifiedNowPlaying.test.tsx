import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { youtubePayload } from '@/test/fixtures/youtube'
import { renderApp } from '@/test/render'
import { activeEngine } from '@/player/playback-coordinator'
import { usePlayerStore } from '@/player/player-store'
import { useYouTubeStore } from '@/player/youtube-store'
import { closeYouTubeSurface, playYouTubeResult, playYouTubeVideo } from '@/player/youtube-actions'

/**
 * One bar, whichever engine is playing.
 *
 * The reported bug: an Audius track was loaded, the visitor started a YouTube
 * video, the official player opened and played it — and the bottom bar went on
 * announcing the Audius track. Two surfaces, two answers to "what is playing".
 *
 * The cause was presentational and the fix is too. `activateYouTube` pauses the
 * audio element but deliberately *keeps* its track, position and queue so the
 * visitor can come back to them; the bar simply never asked whose turn it was.
 * These tests pin both halves: the bar follows the active engine, and the audio
 * session underneath survives untouched.
 */

const video = (overrides = {}) => normalizeYouTubeVideo(youtubePayload(overrides))

const SOURP = video({
  videoId: 'aram0000001',
  title: 'Sourp Sarkis',
  channelTitle: 'Aram Asatryan - Topic',
})
const BAROV = video({
  videoId: 'aram0000002',
  title: 'Barov Ari',
  channelTitle: 'Aram Asatryan - Topic',
})
const NANI = video({
  videoId: 'aram0000003',
  title: 'Nani Im Nani',
  channelTitle: 'Aram Asatryan - Topic',
})

async function playAudioTrack() {
  const harness = renderApp({ route: '/search?q=nova sound' })
  const list = await screen.findByTestId('track-list')
  const row = within(list).getByRole('button', { name: /^Play Midnight Signal by Nova Sound$/i })
  await harness.user.click(row)
  await screen.findByRole('region', { name: 'Now playing' })
  await waitFor(() => expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal'))
  return harness
}

const bar = () => screen.getByRole('region', { name: 'Now playing' })

beforeEach(() => {
  useYouTubeStore.setState({ sessionItems: [], sessionIndex: -1 })
})

describe('the bar follows whichever engine is playing', () => {
  it('shows the YouTube item once YouTube takes over, not the audio track', async () => {
    await playAudioTrack()
    expect(within(bar()).getByText('Midnight Signal')).toBeInTheDocument()

    await playYouTubeVideo(SOURP, { userInitiated: true })

    await waitFor(() => expect(activeEngine()).toBe('youtube'))
    await waitFor(() => expect(within(bar()).getByText('Sourp Sarkis')).toBeInTheDocument())
    expect(within(bar()).getByText(/Aram Asatryan - Topic/)).toBeInTheDocument()
    expect(within(bar()).queryByText('Midnight Signal')).not.toBeInTheDocument()
  })

  it('names YouTube as the source', async () => {
    await playAudioTrack()
    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(within(bar()).getByText(/YouTube/)).toBeInTheDocument())
  })

  it('leaves the audio track, position and queue completely intact underneath', async () => {
    await playAudioTrack()
    usePlayerStore.getState().setCurrentTime(102)
    const before = usePlayerStore.getState()
    const queueBefore = before.queue.map((track) => track.id)

    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(activeEngine()).toBe('youtube'))

    const after = usePlayerStore.getState()
    expect(after.currentTrack?.title).toBe('Midnight Signal')
    expect(after.currentTime).toBe(102)
    expect(after.queue.map((track) => track.id)).toEqual(queueBefore)
    // Paused, not playing — exactly one engine is audible.
    expect(after.status).toBe('paused')
  })

  it('returns to the preserved, paused audio track when the video is closed', async () => {
    const { engine } = await playAudioTrack()
    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(within(bar()).getByText('Sourp Sarkis')).toBeInTheDocument())

    closeYouTubeSurface()

    await waitFor(() => expect(within(bar()).getByText('Midnight Signal')).toBeInTheDocument())
    // Offering to resume, never resuming on its own.
    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(engine.playing).toBe(false)
  })

  it('never renders the expanded audio sheet while YouTube is playing', async () => {
    await playAudioTrack()
    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(activeEngine()).toBe('youtube'))

    expect(screen.queryByTestId('now-playing')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Now Playing' })).not.toBeInTheDocument()
  })
})

describe('the YouTube bar drives YouTube, never the audio queue', () => {
  it('steps through the already-fetched results without touching the audio queue', async () => {
    const { user } = await playAudioTrack()
    const audioQueueBefore = usePlayerStore.getState().queue.map((track) => track.id)
    const audioIndexBefore = usePlayerStore.getState().currentIndex

    await playYouTubeResult([SOURP, BAROV, NANI], BAROV, 'aram asatryan')
    await waitFor(() => expect(within(bar()).getByText('Barov Ari')).toBeInTheDocument())

    await user.click(within(bar()).getByRole('button', { name: 'Next YouTube result' }))
    await waitFor(() => expect(useYouTubeStore.getState().item?.title).toBe('Nani Im Nani'))

    await user.click(within(bar()).getByRole('button', { name: 'Previous YouTube result' }))
    await waitFor(() => expect(useYouTubeStore.getState().item?.title).toBe('Barov Ari'))

    expect(usePlayerStore.getState().queue.map((track) => track.id)).toEqual(audioQueueBefore)
    expect(usePlayerStore.getState().currentIndex).toBe(audioIndexBefore)
    expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal')
  })

  it('disables both steps for a standalone video with no result session', async () => {
    await playAudioTrack()
    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(within(bar()).getByText('Sourp Sarkis')).toBeInTheDocument())

    expect(useYouTubeStore.getState().sessionItems).toHaveLength(0)
    expect(within(bar()).getByRole('button', { name: 'Next YouTube result' })).toBeDisabled()
    expect(within(bar()).getByRole('button', { name: 'Previous YouTube result' })).toBeDisabled()
  })

  it('reads its progress from the YouTube store, not the audio element', async () => {
    await playAudioTrack()
    usePlayerStore.getState().setCurrentTime(102)
    usePlayerStore.getState().setDuration(200)

    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(within(bar()).getByText('Sourp Sarkis')).toBeInTheDocument())
    useYouTubeStore.getState().setProgress(45, 240)

    await waitFor(() => expect(within(bar()).getByText('0:45')).toBeInTheDocument())
    expect(within(bar()).getByText('4:00')).toBeInTheDocument()
    // 1:42 is the audio position, and must not appear.
    expect(within(bar()).queryByText('1:42')).not.toBeInTheDocument()
  })

  it('offers no audio transport at all while YouTube owns playback', async () => {
    await playAudioTrack()
    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(within(bar()).getByText('Sourp Sarkis')).toBeInTheDocument())

    // The audio bar's own controls, by their audio-specific names.
    expect(within(bar()).queryByRole('button', { name: 'Next track' })).not.toBeInTheDocument()
    expect(within(bar()).queryByRole('button', { name: 'Previous track' })).not.toBeInTheDocument()
    expect(within(bar()).queryByRole('slider', { name: 'Seek' })).not.toBeInTheDocument()
  })
})
