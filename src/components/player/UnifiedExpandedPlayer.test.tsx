import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { useUiStore } from '@/app/ui-store'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { youtubePayload } from '@/test/fixtures/youtube'
import { renderApp, youtubeTestFactory } from '@/test/render'
import { usePlayerStore } from '@/player/player-store'
import { playYouTubeVideo } from '@/player/youtube-actions'
import { useYouTubeStore } from '@/player/youtube-store'

/**
 * **One expanded player, whichever engine is loaded.**
 *
 * The reported problem was not that the video player was broken — it starts,
 * continues and recovers. It was that it did not look or behave like the same
 * product: the sheet grew from 560px to 820px and filled 760px of it with the
 * embed, and the transport row underneath quietly lost two of its five controls
 * because the ten-second buttons were gated on `can.queue`. Two shapes, two
 * control sets, one screen — which is how a visitor learns there are two players
 * in here.
 *
 * These tests assert the shared shell as a *comparison* rather than as a list of
 * class names: whatever the audio expanded view renders structurally, the
 * YouTube one renders too, in the same order, in the same slots. A future change
 * that gives one engine a control the other cannot have has to say so explicitly
 * by failing here.
 *
 * What is deliberately **not** asserted as shared: shuffle, repeat, Up next and
 * volume. A result session has no running order and the embed's volume is the
 * visitor's own business through YouTube's native controls, so those stay absent
 * for a video — see `NowPlaying.test.tsx`, which pins that side of the line.
 */

const VIDEO = normalizeYouTubeVideo(
  youtubePayload({
    videoId: 'aram0000001',
    title: 'Sourp Sarkis',
    channelTitle: 'Aram Asatryan - Topic',
    durationSeconds: 240,
  }),
)

const sheet = () => screen.getByRole('dialog', { name: 'Now playing' })

/** Plays an audio track and opens the expanded view over it. */
async function audioExpanded() {
  const harness = renderApp({ route: '/search?q=nova sound' })
  const list = await screen.findByTestId('track-list')
  await harness.user.click(
    within(list).getByRole('button', { name: /^Play Midnight Signal by Nova Sound$/i }),
  )
  await waitFor(() => expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal'))
  useUiStore.getState().setNowPlayingOpen(true)
  await screen.findByRole('dialog', { name: 'Now playing' })
  return harness
}

/**
 * Plays a video. A direct press opens the expanded view on its own — the
 * official player is what the visitor chose.
 */
async function videoExpanded() {
  const harness = renderApp({ route: '/search?q=aram asatryan' })
  await playYouTubeVideo(VIDEO, { userInitiated: true })
  await waitFor(() => expect(useUiStore.getState().nowPlayingOpen).toBe(true))
  await screen.findByRole('dialog', { name: 'Now playing' })
  await waitFor(() => expect(within(sheet()).getByText('Sourp Sarkis')).toBeInTheDocument())
  return harness
}

/**
 * The transport controls, in the order the row renders them.
 *
 * The primary control is normalised to `play/pause`, because its label follows
 * whether the thing is currently running — which is playback state, not layout,
 * and not what a comparison of the two shells is about.
 */
const transportNames = (scope: HTMLElement) =>
  Array.from(scope.querySelectorAll<HTMLElement>('.now-playing-transport button')).map((button) => {
    const label = button.getAttribute('aria-label')
    return label === 'Play' || label === 'Pause' ? 'play/pause' : label
  })

beforeEach(() => {
  useYouTubeStore.setState({ sessionItems: [], sessionIndex: -1 })
})

/* ==========================================================================
   The shared shell
   ========================================================================== */

describe('both engines render the same expanded shell', () => {
  it('gives a video the same transport row, in the same order, as a track', async () => {
    const track = await audioExpanded()
    const audio = transportNames(sheet())
    // Unmounted before the second app is rendered: two live trees would leave
    // two dialogs on the screen, which is not the thing under test.
    track.unmount()

    await videoExpanded()
    const youtube = transportNames(sheet())

    expect(audio).toEqual([
      'Seek back 10 seconds',
      'Previous track',
      'play/pause',
      'Next track',
      'Seek forward 10 seconds',
    ])
    // The claim of this whole pass, stated as an equality rather than as five
    // separate presence checks: the row does not change shape with the engine.
    expect(youtube).toEqual(audio)
  })

  it('gives a video the same structural regions as a track', async () => {
    const track = await audioExpanded()
    const regionsFor = (scope: HTMLElement) =>
      [
        '.now-playing-meta',
        '.now-playing-titles',
        '.now-playing-actions',
        '.now-playing-transport',
      ].filter((selector) => scope.querySelector(selector) !== null)
    const audio = regionsFor(sheet())
    track.unmount()

    await videoExpanded()
    expect(regionsFor(sheet())).toEqual(audio)
  })

  it('keeps the collapse affordance and the scrubber for both', async () => {
    await videoExpanded()
    const dialog = sheet()

    expect(within(dialog).getByRole('button', { name: 'Collapse Now Playing' })).toBeInTheDocument()
    expect(within(dialog).getByRole('slider', { name: 'Seek' })).toBeInTheDocument()
    expect(dialog.querySelector('.now-playing-grab')).not.toBeNull()
  })

  /**
   * The video occupies the media slot a cover would, and the sheet does not draw
   * a placeholder cover beside it. One media region, not two.
   */
  it('puts the player in the media slot rather than beside a cover', async () => {
    await videoExpanded()
    const dialog = sheet()

    expect(within(dialog).getByTestId('youtube-stage')).toBeInTheDocument()
    expect(dialog.querySelector('.now-playing-art')).toBeNull()
    expect(dialog.querySelectorAll('.yt-stage-frame')).toHaveLength(1)
  })

  it('keeps the heart and the menu in the same action row for a video', async () => {
    await videoExpanded()
    const actions = sheet().querySelector<HTMLElement>('.now-playing-actions')
    expect(actions).not.toBeNull()

    expect(
      within(actions!).getByRole('button', { name: /Save .* to Liked Songs/i }),
    ).toBeInTheDocument()
    expect(within(actions!).getByRole('button', { name: /More actions/i })).toBeInTheDocument()
  })
})

/* ==========================================================================
   No second player underneath
   ========================================================================== */

describe('the expanded view is the only transport on screen', () => {
  it('renders exactly one play control and one scrubber for a video', async () => {
    await videoExpanded()

    // Across the whole document, not just the sheet: the point is that nothing
    // is stacked underneath it.
    expect(screen.getAllByRole('button', { name: /^(Play|Pause)$/ })).toHaveLength(1)
    expect(screen.getAllByRole('slider', { name: 'Seek' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Next track' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Previous track' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Seek forward 10 seconds' })).toHaveLength(1)
  })

  it('does not leave the mini-player rendered beneath it', async () => {
    await videoExpanded()

    expect(document.querySelector('.music-player')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument()
    // And one shell, holding one stage.
    expect(document.querySelectorAll('.player-shell')).toHaveLength(1)
    expect(screen.getAllByTestId('youtube-stage')).toHaveLength(1)
  })

  /**
   * Collapsing hands back one bar and takes the player away with it.
   *
   * This asserted one surviving stage and an unchanged construction count, back
   * when the player was docked beside the mini-player to keep it mounted. That
   * docked card is the floating box the report was about, so the count is now
   * zero and the video keeps its place through the store instead.
   */
  it('hands back exactly one mini-player on collapse, and no player', async () => {
    const harness = await videoExpanded()

    await harness.user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(document.querySelectorAll('.music-player')).toHaveLength(1)
    expect(document.querySelectorAll('.now-playing-body')).toHaveLength(0)
    expect(screen.queryAllByTestId('youtube-stage')).toHaveLength(0)
    expect(document.querySelectorAll('.yt-stage-frame')).toHaveLength(0)
    // The item is still loaded, so the bar goes on showing it with a Play button.
    expect(useYouTubeStore.getState().item?.videoId).toBe('aram0000001')
  })
})

/* ==========================================================================
   The ten-second controls, on the YouTube engine
   ========================================================================== */

describe('the ten-second controls drive the video', () => {
  const position = () => useYouTubeStore.getState().currentTime
  const player = () => youtubeTestFactory().current()

  it('moves the playhead forward through the documented seekTo', async () => {
    const harness = await videoExpanded()
    expect(position()).toBe(0)

    await harness.user.click(
      within(sheet()).getByRole('button', { name: 'Seek forward 10 seconds' }),
    )

    // The app's own published position, and the player's, agree.
    await waitFor(() => expect(position()).toBe(10))
    expect(player()?.lastSeek).toBe(10)
    expect(player()?.seekCalls).toBe(1)
  })

  it('moves it back again, and never past the beginning', async () => {
    const harness = await videoExpanded()
    const forward = within(sheet()).getByRole('button', { name: 'Seek forward 10 seconds' })
    await harness.user.click(forward)
    await harness.user.click(forward)
    await waitFor(() => expect(position()).toBe(20))

    const back = within(sheet()).getByRole('button', { name: 'Seek back 10 seconds' })
    await harness.user.click(back)
    await waitFor(() => expect(position()).toBe(10))

    // Three more presses from 10s would reach -20 without the clamp.
    await harness.user.click(back)
    await harness.user.click(back)
    await harness.user.click(back)
    await waitFor(() => expect(position()).toBe(0))
    expect(player()?.lastSeek).toBe(0)
  })

  it('clamps forward against the length the rail is showing', async () => {
    const harness = await videoExpanded()
    // Just short of the item's published 240s, before the embed has reported a
    // duration of its own — the gap that used to make these buttons inert.
    useYouTubeStore.getState().setProgress(236, 0)

    await harness.user.click(
      within(sheet()).getByRole('button', { name: 'Seek forward 10 seconds' }),
    )

    await waitFor(() => expect(position()).toBe(240))
  })

  /**
   * The regression the fallback exists for. The store's `duration` is zero until
   * the embed reports one, and seeking used to consult the store alone — so a
   * cued video drew a live scrubber and two enabled buttons over a seek that
   * silently refused.
   */
  it('works before the embed has reported a duration of its own', async () => {
    const harness = await videoExpanded()
    expect(useYouTubeStore.getState().duration).toBe(0)

    await harness.user.click(
      within(sheet()).getByRole('button', { name: 'Seek forward 10 seconds' }),
    )

    await waitFor(() => expect(position()).toBe(10))
  })

  it('updates the visible time readout, not merely the store', async () => {
    const harness = await videoExpanded()
    const dialog = sheet()
    expect(within(dialog).getByText('0:00')).toBeInTheDocument()

    await harness.user.click(
      within(dialog).getByRole('button', { name: 'Seek forward 10 seconds' }),
    )

    await waitFor(() => expect(within(sheet()).getByText('0:10')).toBeInTheDocument())
    // The published length still comes from the item's own metadata.
    expect(within(sheet()).getByText('4:00')).toBeInTheDocument()
  })
})
