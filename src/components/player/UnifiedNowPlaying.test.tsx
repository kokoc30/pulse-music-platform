import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { youtubePayload } from '@/test/fixtures/youtube'
import { renderApp } from '@/test/render'
import { activeEngine } from '@/player/playback-coordinator'
import { usePlayerStore } from '@/player/player-store'
import { useYouTubeStore } from '@/player/youtube-store'
import { closeYouTubeSurface, playYouTubeResult, playYouTubeVideo } from '@/player/youtube-actions'

/**
 * One player, whichever engine is playing.
 *
 * The reported bug: an Audius track was loaded, the visitor started a YouTube
 * video, the official player opened and played it — and the bottom bar went on
 * announcing the Audius track. Two surfaces, two answers to "what is playing".
 *
 * The cause was presentational and the fix is too. `activateYouTube` pauses the
 * audio element but deliberately *keeps* its track, position and queue so the
 * visitor can come back to them; the player simply never asked whose turn it
 * was. These tests pin both halves: the player follows the active engine, and
 * the audio session underneath survives untouched.
 *
 * **Which presentation these read from.** There is one player shell with two
 * presentations, and exactly one is rendered at a time — a mini-player, or the
 * expanded Now Playing view. Pressing a YouTube result opens the expanded one,
 * because the official video is the content and a direct press is a clear choice
 * of it; an audio result still starts the mini-player, untouched. So `player()`
 * below is "whichever presentation is up", which is the only honest way to ask
 * what the visitor can actually see.
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

/** Whichever presentation of the one player is currently on screen. */
const player = () => {
  const shell = document.querySelector('.player-shell')
  if (!shell) throw new Error('There is no player on screen')
  return shell as HTMLElement
}

/** The mini-player specifically, for the claims that are about that one. */
const miniPlayer = () => screen.getByRole('region', { name: 'Now playing' })

beforeEach(() => {
  useYouTubeStore.setState({ sessionItems: [], sessionIndex: -1 })
})

describe('the player follows whichever engine is playing', () => {
  it('shows the YouTube item once YouTube takes over, not the audio track', async () => {
    await playAudioTrack()
    expect(within(player()).getByText('Midnight Signal')).toBeInTheDocument()

    await playYouTubeVideo(SOURP, { userInitiated: true })

    await waitFor(() => expect(activeEngine()).toBe('youtube'))
    await waitFor(() => expect(within(player()).getByText('Sourp Sarkis')).toBeInTheDocument())
    expect(within(player()).getByText(/Aram Asatryan - Topic/)).toBeInTheDocument()
    expect(within(player()).queryByText('Midnight Signal')).not.toBeInTheDocument()
  })

  it('names YouTube as the source', async () => {
    await playAudioTrack()
    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(within(player()).getByText(/YouTube/)).toBeInTheDocument())
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
    await waitFor(() => expect(within(player()).getByText('Sourp Sarkis')).toBeInTheDocument())

    closeYouTubeSurface()

    await waitFor(() => expect(within(player()).getByText('Midnight Signal')).toBeInTheDocument())
    // Offering to resume, never resuming on its own.
    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(engine.playing).toBe(false)
  })

  /**
   * A press on a video opens the expanded player, and a press on a track does
   * not — a difference in *route*, not a difference in surface.
   *
   * Both engines have the same two presentations and the same controls in each.
   * What differs is where the visitor is put by default, and the reason is the
   * content: a video is something to watch, so the official player becomes the
   * thing on screen; an album cover is not, so a track starts in the mini-player
   * and expands when it is asked to.
   */
  it('opens the expanded player for a video, and the mini-player for a track', async () => {
    const { user } = await playAudioTrack()
    expect(screen.queryByRole('dialog', { name: 'Now playing' })).not.toBeInTheDocument()
    expect(miniPlayer()).toBeInTheDocument()

    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(activeEngine()).toBe('youtube'))

    const dialog = await screen.findByRole('dialog', { name: 'Now playing' })
    expect(within(dialog).getByRole('heading', { name: 'Sourp Sarkis' })).toBeInTheDocument()

    // And coming down leaves one mini-player, carrying the same expand
    // affordance a track has.
    await user.click(within(dialog).getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Now playing' })).not.toBeInTheDocument(),
    )
    expect(
      within(miniPlayer()).getByRole('button', { name: 'Open Now Playing' }),
    ).toBeInTheDocument()
  })

  /**
   * One player, kept across every change of presentation.
   *
   * This assertion has been rewritten twice, because the stage has had two wrong
   * homes. It first lived in the expanded sheet, which had to be forced open for
   * a video to play at all. It then lived in the bar's artwork slot, and this
   * test asserted the sheet did *not* contain it — which was true, and was the
   * defect: the sheet was laid out above a bar that still held the video and a
   * complete second transport under it.
   *
   * The stage belongs to neither. It is a stable child of the player shell, so
   * it is inside whichever presentation is up, it is never reparented and it is
   * never rebuilt. That is what this pins: one stage, the same DOM node, still
   * playing, across expand and collapse and expand again.
   */
  /**
   * One player while expanded, none while collapsed — never two.
   *
   * This used to assert that the *same node* survived a round trip, because the
   * stage was docked beside the mini-player rather than mounted inside the view.
   * Keeping it mounted is what put a floating video box next to the bar, so the
   * player is now mounted only while the expanded view is open and the round
   * trip rebuilds it. What must never happen either way is two.
   */
  it('mounts one player while expanded and none while collapsed', async () => {
    const { user } = await playAudioTrack()
    await playYouTubeResult([SOURP, BAROV], SOURP, 'aram asatryan')
    const dialog = await screen.findByRole('dialog', { name: 'Now playing' })
    await waitFor(() => expect(within(player()).getByText('Sourp Sarkis')).toBeInTheDocument())

    const stages = screen.getAllByTestId('youtube-stage')
    expect(stages).toHaveLength(1)
    // Inside the expanded view the press opened, not docked underneath it.
    expect(dialog.contains(stages[0])).toBe(true)

    // Collapsing removes it, and pauses rather than leaving a player running
    // where nobody can see it.
    await user.click(within(dialog).getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Now playing' })).not.toBeInTheDocument(),
    )
    expect(screen.queryAllByTestId('youtube-stage')).toHaveLength(0)
    expect(useYouTubeStore.getState().status).toBe('paused')
    // The bar is the whole of the collapsed presentation, and the item is still
    // loaded in it.
    expect(within(miniPlayer()).getByText('Sourp Sarkis')).toBeInTheDocument()

    // And expanding again brings exactly one back.
    await user.click(within(miniPlayer()).getByRole('button', { name: 'Open Now Playing' }))
    await screen.findByRole('dialog', { name: 'Now playing' })
    expect(screen.getAllByTestId('youtube-stage')).toHaveLength(1)
  })

  /**
   * The mini-player draws the same row for every provider, cover included.
   *
   * It briefly drew a 200px live player in the slot a 56px cover occupies, which
   * is how the bar came to be roughly 216px of black video card on a phone. The
   * live player is the shell's docked stage now, and a video's *still* — its own
   * unmodified 16:9 frame from YouTube's CDN — goes in the slot, exactly where a
   * track's cover goes.
   */
  it('draws the same artwork slot for a video as for a track', async () => {
    const slotIndex = () => {
      const row = [...player().querySelectorAll('.player-track > *')]
      return row.findIndex((node) => node.matches('img'))
    }

    const { user } = await playAudioTrack()
    expect(player().querySelector('.player-track img')).toBeInTheDocument()
    const audioSlot = slotIndex()

    await playYouTubeResult([SOURP], SOURP, 'aram asatryan')
    const dialog = await screen.findByRole('dialog', { name: 'Now playing' })
    await user.click(within(dialog).getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(within(player()).getByText('Sourp Sarkis')).toBeInTheDocument())

    const cover = player().querySelector('.player-track img')
    expect(cover).toBeInTheDocument()
    expect(cover).toHaveAttribute('src', expect.stringContaining('ytimg.com'))
    expect(slotIndex()).toBe(audioSlot)
    // And it is the *only* thing representing the video here: no live player in
    // the artwork slot, and none docked beside the bar either.
    expect(player().querySelector('.player-track [data-testid="youtube-stage"]')).toBeNull()
    expect(screen.queryAllByTestId('youtube-stage')).toHaveLength(0)
  })
})

describe('the YouTube bar drives YouTube, never the audio queue', () => {
  it('steps through the already-fetched results without touching the audio queue', async () => {
    const { user } = await playAudioTrack()
    const audioQueueBefore = usePlayerStore.getState().queue.map((track) => track.id)
    const audioIndexBefore = usePlayerStore.getState().currentIndex

    await playYouTubeResult([SOURP, BAROV, NANI], BAROV, 'aram asatryan')
    await waitFor(() => expect(within(player()).getByText('Barov Ari')).toBeInTheDocument())

    await user.click(within(player()).getByRole('button', { name: 'Next track' }))
    await waitFor(() => expect(useYouTubeStore.getState().item?.title).toBe('Nani Im Nani'))

    await user.click(within(player()).getByRole('button', { name: 'Previous track' }))
    await waitFor(() => expect(useYouTubeStore.getState().item?.title).toBe('Barov Ari'))

    expect(usePlayerStore.getState().queue.map((track) => track.id)).toEqual(audioQueueBefore)
    expect(usePlayerStore.getState().currentIndex).toBe(audioIndexBefore)
    expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal')
  })

  /**
   * A standalone video has nothing *behind* it and something ahead of it.
   *
   * Previous can only walk backwards through results already in hand, so it is
   * genuinely disabled. Next is not: with continuous play on, the action behind
   * it extends the session with one related search, and greying it out would be
   * the control disagreeing with the action again.
   */
  it('disables Previous for a standalone video, but not Next', async () => {
    await playAudioTrack()
    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(within(player()).getByText('Sourp Sarkis')).toBeInTheDocument())

    expect(useYouTubeStore.getState().sessionItems).toHaveLength(0)
    expect(within(player()).getByRole('button', { name: 'Previous track' })).toBeDisabled()
    expect(within(player()).getByRole('button', { name: 'Next track' })).toBeEnabled()

    useYouTubeStore.getState().setContinuousPlay(false)
    await waitFor(() =>
      expect(within(player()).getByRole('button', { name: 'Next track' })).toBeDisabled(),
    )
  })

  it('reads its progress from the YouTube store, not the audio element', async () => {
    await playAudioTrack()
    usePlayerStore.getState().setCurrentTime(102)
    usePlayerStore.getState().setDuration(200)

    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(within(player()).getByText('Sourp Sarkis')).toBeInTheDocument())
    useYouTubeStore.getState().setProgress(45, 240)

    await waitFor(() => expect(within(player()).getByText('0:45')).toBeInTheDocument())
    expect(within(player()).getByText('4:00')).toBeInTheDocument()
    // 1:42 is the audio position, and must not appear.
    expect(within(player()).queryByText('1:42')).not.toBeInTheDocument()
  })

  /**
   * The transport is now *shared* — same buttons, same accessible names, for
   * every provider. So the claim worth pinning is no longer "the audio controls
   * are absent"; it is that the shared controls reach the YouTube engine and
   * leave the audio session alone. The step test above proves the queue is
   * untouched; this proves the play control is too.
   */
  it('drives the video from the shared play control, leaving the audio paused', async () => {
    const { user, engine } = await playAudioTrack()
    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(useYouTubeStore.getState().status).toBe('playing'))
    expect(engine.playing).toBe(false)

    await user.click(within(player()).getByRole('button', { name: 'Pause' }))

    await waitFor(() => expect(useYouTubeStore.getState().status).toBe('paused'))
    // The audio element was never asked to do anything.
    expect(engine.playing).toBe(false)
    expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal')
  })

  it('withholds the controls a result session has no answer for', async () => {
    await playAudioTrack()
    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(within(player()).getByText('Sourp Sarkis')).toBeInTheDocument())

    // Absent rather than disabled: a video has no running order and no volume
    // of ours to set, so offering either would be a promise the app cannot keep.
    expect(within(player()).queryByRole('button', { name: /Shuffle/i })).not.toBeInTheDocument()
    expect(within(player()).queryByRole('button', { name: /Repeat/i })).not.toBeInTheDocument()
    expect(within(player()).queryByRole('slider', { name: 'Volume' })).not.toBeInTheDocument()

    // The seek rail, by contrast, is real for a video: the IFrame API publishes
    // `seekTo`, so the same rail scrubs both engines.
    expect(within(player()).getByRole('slider', { name: 'Seek' })).toBeInTheDocument()
  })

  it('scrubs the video through the shared rail', async () => {
    await playAudioTrack()
    await playYouTubeVideo(SOURP, { userInitiated: true })
    await waitFor(() => expect(within(player()).getByText('Sourp Sarkis')).toBeInTheDocument())
    useYouTubeStore.getState().setProgress(0, 240)

    const slider = await waitFor(() => within(player()).getByRole('slider', { name: 'Seek' }))
    slider.focus()
    await userEvent.keyboard('{End}')

    await waitFor(() => expect(useYouTubeStore.getState().currentTime).toBe(240))
  })
})
