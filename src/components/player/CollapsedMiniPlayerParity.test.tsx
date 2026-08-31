import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { useUiStore } from '@/app/ui-store'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { youtubePayload } from '@/test/fixtures/youtube'
import { renderApp, youtubeTestFactory } from '@/test/render'
import { activeEngine } from '@/player/playback-coordinator'
import { usePlayerStore } from '@/player/player-store'
import { playYouTubeVideo } from '@/player/youtube-actions'
import { useYouTubeStore } from '@/player/youtube-store'

/**
 * **Collapsed, a video is a bottom bar. Nothing else is on the screen.**
 *
 * The reported UI: a Pulse mini-player along the bottom *and* a separate
 * official YouTube video box floating in the bottom-right corner. Two players,
 * where an audio track showed one compact row.
 *
 * It was not a styling accident. The embed must be mounted and at least
 * 200 x 200 while it plays, and reparenting an iframe reloads it, so the stage
 * was kept permanently mounted as a sibling of both presentations — *docked*
 * beside the mini-player when collapsed, the primary media region when expanded.
 * Every constraint was satisfied and the product had two visible player
 * surfaces.
 *
 * The stage is mounted only while the expanded view is open now. Collapsed there
 * is no player on the page at all for either engine, so:
 *
 * · a video draws its own thumbnail in the same 56px artwork slot a cover
 *   occupies, through the same component,
 * · collapsing pauses and remembers exactly where the video was,
 * · pressing Play on the collapsed bar opens the view, rebuilds the player and
 *   resumes from that position — one gesture, from the visitor's side.
 *
 * **Absent, never hidden.** `opacity: 0`, `visibility: hidden` and offscreen
 * parking would each leave a live player where the visitor cannot see it, which
 * is precisely the background playback the developer policies prohibit. These
 * tests count elements rather than inspect styles, so a hidden player fails them
 * exactly as a visible one would.
 */

const VIDEO = normalizeYouTubeVideo(
  youtubePayload({
    videoId: 'aram0000001',
    title: 'Sourp Sarkis',
    channelTitle: 'Aram Asatryan - Topic',
    durationSeconds: 240,
  }),
)

const bar = () => screen.getByRole('region', { name: 'Now playing' })
const dialog = () => screen.queryByRole('dialog', { name: 'Now playing' })
const stages = () => screen.queryAllByTestId('youtube-stage')
const player = () => youtubeTestFactory().current()

/** Everything the bar renders in its info row, in order, as element names. */
const trackRowShape = () =>
  Array.from(bar().querySelectorAll<HTMLElement>('.player-track > *')).map((node) =>
    node.tagName.toLowerCase(),
  )

/** The transport controls the bar offers, in order. */
const transportShape = () =>
  Array.from(bar().querySelectorAll<HTMLElement>('.player-controls button')).map((node) => {
    const label = node.getAttribute('aria-label')
    return label === 'Play' || label === 'Pause' ? 'play/pause' : label
  })

async function audioCollapsed() {
  const harness = renderApp({ route: '/search?q=nova sound' })
  const list = await screen.findByTestId('track-list')
  await harness.user.click(
    within(list).getByRole('button', { name: /^Play Midnight Signal by Nova Sound$/i }),
  )
  await waitFor(() => expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal'))
  await screen.findByRole('region', { name: 'Now playing' })
  return harness
}

/**
 * A video, played and then collapsed.
 *
 * A direct press opens the expanded view on its own — the official player is
 * what the visitor chose — so reaching the collapsed state means coming back
 * down from it, which is also the journey the report describes.
 */
async function videoCollapsed() {
  const harness = renderApp({ route: '/search?q=aram asatryan' })
  await playYouTubeVideo(VIDEO, { userInitiated: true })
  await screen.findByRole('dialog', { name: 'Now playing' })
  await waitFor(() => expect(useYouTubeStore.getState().status).toBe('playing'))

  await harness.user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))
  await waitFor(() => expect(dialog()).not.toBeInTheDocument())
  return harness
}

beforeEach(() => {
  useYouTubeStore.setState({ sessionItems: [], sessionIndex: -1 })
})

/* ==========================================================================
   One bottom bar, whichever engine is loaded
   ========================================================================== */

describe('the collapsed presentation', () => {
  it('is one bar and no player for an audio track', async () => {
    await audioCollapsed()

    expect(document.querySelectorAll('.music-player')).toHaveLength(1)
    expect(stages()).toHaveLength(0)
    expect(document.querySelectorAll('.yt-stage-frame')).toHaveLength(0)
    expect(dialog()).not.toBeInTheDocument()
  })

  /** The reported screenshot, as an assertion. */
  it('is one bar and no player for a video either', async () => {
    await videoCollapsed()

    expect(activeEngine()).toBe('youtube')
    expect(document.querySelectorAll('.music-player')).toHaveLength(1)
    // The floating box. There is no longer one, hidden or otherwise.
    expect(stages()).toHaveLength(0)
    expect(document.querySelectorAll('.yt-stage-frame')).toHaveLength(0)
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })

  it('draws the video as a thumbnail in the slot a cover occupies', async () => {
    await audioCollapsed()
    const audioRow = trackRowShape()
    const audioSlot = audioRow.indexOf('img')
    expect(audioSlot).toBeGreaterThanOrEqual(0)

    await playYouTubeVideo(VIDEO, { userInitiated: true })
    await screen.findByRole('dialog', { name: 'Now playing' })
    useUiStore.getState().setNowPlayingOpen(false)
    await waitFor(() => expect(dialog()).not.toBeInTheDocument())

    /**
     * The same three slots, in the same order and at the same index: the expand
     * control, the artwork, the title cluster.
     *
     * The rows are not identical beyond that and should not be — an Audius track
     * carries a dismissible permalink icon at the end, and a video drops it
     * because its required backlink already rides on the always-visible credit
     * line rather than linking to the same page twice. That is an attribution
     * rule, not a layout difference.
     */
    expect(trackRowShape().slice(0, audioSlot + 2)).toEqual(audioRow.slice(0, audioSlot + 2))
    const cover = bar().querySelector('.player-track img')
    expect(cover).toHaveAttribute('src', expect.stringContaining('ytimg.com'))
    // A still, not a live player, and nothing docked beside the bar either.
    expect(bar().querySelector('.player-track [data-testid="youtube-stage"]')).toBeNull()
    expect(stages()).toHaveLength(0)
  })

  it('offers the same transport, in the same order, for both engines', async () => {
    const track = await audioCollapsed()
    const audio = transportShape()
    // Unmounted before the second app renders: two live trees would put two of
    // everything on the screen, which is not the thing under test.
    track.unmount()

    await videoCollapsed()
    // Shuffle and repeat are audio queue settings and are absent for a video —
    // `PlayerBar.test.tsx` pins that. What must match is the transport itself.
    const core = ['Previous track', 'play/pause', 'Next track']
    expect(audio.filter((name) => core.includes(name as string))).toEqual(core)
    expect(transportShape().filter((name) => core.includes(name as string))).toEqual(core)
  })

  it('keeps the same expand affordance for both', async () => {
    const track = await audioCollapsed()
    expect(within(bar()).getByRole('button', { name: 'Open Now Playing' })).toBeInTheDocument()
    track.unmount()

    await videoCollapsed()
    expect(within(bar()).getByRole('button', { name: 'Open Now Playing' })).toBeInTheDocument()
  })
})

/* ==========================================================================
   Collapsing a playing video
   ========================================================================== */

describe('collapsing a video that is playing', () => {
  it('pauses it rather than leaving it running out of sight', async () => {
    await videoCollapsed()

    expect(useYouTubeStore.getState().status).toBe('paused')
    expect(player()).toBeNull()
    // The item is still loaded: this is a collapse, not a dismissal.
    expect(useYouTubeStore.getState().item?.videoId).toBe('aram0000001')
    expect(within(bar()).getByText('Sourp Sarkis')).toBeInTheDocument()
  })

  it('captures the position from the player, not from the last progress tick', async () => {
    const harness = renderApp({ route: '/search?q=aram asatryan' })
    await playYouTubeVideo(VIDEO, { userInitiated: true })
    await screen.findByRole('dialog', { name: 'Now playing' })
    await waitFor(() => expect(useYouTubeStore.getState().status).toBe('playing'))

    // Where the video really is. The store still says 0 — the progress timer
    // runs once a second and has not fired.
    player()?.setCurrentTime(42)
    expect(useYouTubeStore.getState().currentTime).toBe(0)

    await harness.user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(dialog()).not.toBeInTheDocument())

    expect(useYouTubeStore.getState().currentTime).toBe(42)
  })

  it('leaves audio playing, because audio has no player to remove', async () => {
    const harness = await audioCollapsed()
    useUiStore.getState().setNowPlayingOpen(true)
    await screen.findByRole('dialog', { name: 'Now playing' })

    await harness.user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(dialog()).not.toBeInTheDocument())

    expect(harness.engine.playing).toBe(true)
    expect(usePlayerStore.getState().status).toBe('playing')
  })
})

/* ==========================================================================
   Play, from the collapsed bar
   ========================================================================== */

describe('pressing Play on a collapsed video', () => {
  /**
   * The required regression, end to end. Nothing plays in the background and
   * nothing is faked: the sheet comes up because the video is about to be
   * visible in it, and the press the visitor made is what starts it.
   */
  it('opens the expanded view, rebuilds the player and resumes', async () => {
    const harness = renderApp({ route: '/search?q=aram asatryan' })
    await playYouTubeVideo(VIDEO, { userInitiated: true })
    await screen.findByRole('dialog', { name: 'Now playing' })
    await waitFor(() => expect(useYouTubeStore.getState().status).toBe('playing'))

    player()?.setCurrentTime(42)
    await harness.user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(dialog()).not.toBeInTheDocument())
    expect(stages()).toHaveLength(0)
    expect(useYouTubeStore.getState().status).toBe('paused')

    await harness.user.click(within(bar()).getByRole('button', { name: 'Play' }))

    // The view opens…
    await screen.findByRole('dialog', { name: 'Now playing' })
    // …one player is built in it…
    await waitFor(() => expect(stages()).toHaveLength(1))
    expect(player()).not.toBeNull()
    // …with the same video, from where it was left.
    await waitFor(() => expect(useYouTubeStore.getState().status).toBe('playing'))
    expect(player()?.videoId).toBe('aram0000001')
    expect(player()?.lastSeek).toBe(42)
    expect(useYouTubeStore.getState().currentTime).toBe(42)
  })

  it('never leaves two players on the page while doing it', async () => {
    const harness = await videoCollapsed()
    await harness.user.click(within(bar()).getByRole('button', { name: 'Play' }))
    await screen.findByRole('dialog', { name: 'Now playing' })
    await waitFor(() => expect(stages()).toHaveLength(1))

    expect(document.querySelectorAll('.yt-stage-frame')).toHaveLength(1)
    expect(document.querySelectorAll('.music-player')).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: /^(Play|Pause)$/ })).toHaveLength(1)
  })

  /** Expanding by hand restores the video too, cued rather than playing. */
  it('is also what the expand control does, minus the playing', async () => {
    const harness = await videoCollapsed()
    await harness.user.click(within(bar()).getByRole('button', { name: 'Open Now Playing' }))
    await screen.findByRole('dialog', { name: 'Now playing' })

    await waitFor(() => expect(stages()).toHaveLength(1))
    await waitFor(() => expect(player()?.videoId).toBe('aram0000001'))
    expect(player()?.playing).toBe(false)
    expect(useYouTubeStore.getState().item?.videoId).toBe('aram0000001')
  })
})

/* ==========================================================================
   Expanded
   ========================================================================== */

describe('the expanded presentation', () => {
  it('holds exactly one player and no mini-player', async () => {
    renderApp({ route: '/search?q=aram asatryan' })
    await playYouTubeVideo(VIDEO, { userInitiated: true })
    const view = await screen.findByRole('dialog', { name: 'Now playing' })

    expect(stages()).toHaveLength(1)
    expect(view.contains(stages()[0])).toBe(true)
    expect(document.querySelectorAll('.music-player')).toHaveLength(0)
    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.now-playing-transport')).toHaveLength(1)
  })

  /**
   * A direct press on a video opens the expanded view rather than starting into
   * the collapsed one — the player has to be somewhere, and the only place it
   * exists is here.
   */
  it('is where a direct press on a video starts', async () => {
    renderApp({ route: '/search?q=aram asatryan' })
    await playYouTubeVideo(VIDEO, { userInitiated: true })

    await screen.findByRole('dialog', { name: 'Now playing' })
    expect(useUiStore.getState().nowPlayingOpen).toBe(true)
    await waitFor(() => expect(useYouTubeStore.getState().status).toBe('playing'))
    expect(stages()).toHaveLength(1)
  })
})
