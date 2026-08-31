import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { useLibraryStore } from '@/library/store'
import { usePlayerStore } from '@/player/player-store'
import { useYouTubeStore } from '@/player/youtube-store'
import { rememberTracks } from '@/player/autoplay'
import type { Track } from '@/music/types'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { youtubePayload } from '@/test/fixtures/youtube'
import { playYouTubeVideo } from '@/player/youtube-actions'

/**
 * The expanded Now Playing view, through the real app shell.
 *
 * The load-bearing claim is that this is a *view*, not a player: opening it must
 * not reload the track, closing it must not pause, and every control must reach
 * the same action the bottom bar reaches. Most of this file is about proving
 * that the audio element was left alone.
 */

async function playFirstSearchResult() {
  const harness = renderApp({ route: '/search?q=nova sound' })
  const list = await screen.findByTestId('track-list')
  await harness.user.click(
    within(list).getByRole('button', { name: /^Play Midnight Signal by Nova Sound$/i }),
  )
  await screen.findByRole('region', { name: 'Now playing' })
  return harness
}

async function openSheet(user: ReturnType<typeof renderApp>['user']) {
  await user.click(screen.getByRole('button', { name: 'Open Now Playing' }))
  return screen.findByRole('dialog', { name: 'Now playing' })
}

const sheet = () => screen.queryByRole('dialog', { name: 'Now playing' })
const player = () => usePlayerStore.getState()

describe('opening and collapsing', () => {
  it('is closed until something opens it', async () => {
    await playFirstSearchResult()
    expect(sheet()).toBeNull()
  })

  it('opens from the expand control', async () => {
    const { user } = await playFirstSearchResult()
    const dialog = await openSheet(user)

    expect(within(dialog).getByRole('heading', { name: 'Midnight Signal' })).toBeInTheDocument()
    expect(within(dialog).getByText('Nova Sound')).toBeInTheDocument()
  })

  it('opens from a click on the track text, for mouse users', async () => {
    const { user } = await playFirstSearchResult()
    // Scoped to the bar: the same title also appears in the search row above.
    const bar = screen.getByRole('region', { name: 'Now playing' })
    await user.click(within(bar).getByText('Midnight Signal'))
    expect(await screen.findByRole('dialog', { name: 'Now playing' })).toBeInTheDocument()
  })

  it('collapses from its own control', async () => {
    const { user } = await playFirstSearchResult()
    const dialog = await openSheet(user)

    await user.click(within(dialog).getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(sheet()).toBeNull())
  })

  it('collapses on Escape', async () => {
    const { user } = await playFirstSearchResult()
    await openSheet(user)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(sheet()).toBeNull())
  })

  /**
   * The reverse of what this asserted before, and the reversal is the fix.
   *
   * The mini-player used to stay on screen underneath the expanded view, which
   * meant a second Play, a second Next and Previous, a second heart and a second
   * progress rail sat behind the panel — visible under it on a phone, and
   * reachable by Tab and by a screen reader at every width. Hiding it in CSS
   * would have left every one of those controls in the accessibility tree, so it
   * is not hidden: expanded and collapsed are alternatives, and only one of them
   * is rendered.
   */
  it('replaces the mini-player rather than leaving it underneath', async () => {
    const { user } = await playFirstSearchResult()
    const dialog = await openSheet(user)

    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument()
    expect(document.querySelector('.music-player')).toBeNull()
    // One transport, and it is this one.
    expect(screen.getAllByRole('button', { name: /^(Play|Pause)$/ })).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: 'Pause' })).toBeInTheDocument()

    // Coming down brings exactly one mini-player back.
    await user.click(within(dialog).getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(sheet()).toBeNull())
    expect(screen.getByRole('region', { name: 'Now playing' })).toBeInTheDocument()
  })
})

describe('it is a view, not a player', () => {
  it('does not reload the track when opened', async () => {
    const { user, engine } = await playFirstSearchResult()
    const loadsBefore = engine.loadCount

    await openSheet(user)
    expect(engine.loadCount).toBe(loadsBefore)
    expect(engine.playing).toBe(true)
  })

  it('does not pause when collapsed', async () => {
    const { user, engine } = await playFirstSearchResult()
    const dialog = await openSheet(user)
    await waitFor(() => expect(engine.playing).toBe(true))

    await user.click(within(dialog).getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(sheet()).toBeNull())

    expect(engine.playing).toBe(true)
    expect(player().status).toBe('playing')
  })

  it('keeps the same track across open and close', async () => {
    const { user } = await playFirstSearchResult()
    const before = player().currentTrack?.id

    const dialog = await openSheet(user)
    await user.click(within(dialog).getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(sheet()).toBeNull())

    expect(player().currentTrack?.id).toBe(before)
  })

  it('creates no second audio element', async () => {
    const { user } = await playFirstSearchResult()
    await openSheet(user)
    // The engine is a module singleton; the DOM must show no rival element.
    expect(document.querySelectorAll('audio')).toHaveLength(0)
  })
})

describe('transport controls drive the one player', () => {
  it('pauses and resumes through the shared action', async () => {
    const { user, engine } = await playFirstSearchResult()
    const dialog = await openSheet(user)
    await waitFor(() => expect(engine.playing).toBe(true))

    await user.click(within(dialog).getByRole('button', { name: 'Pause' }))
    expect(engine.playing).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(engine.playing).toBe(true))
  })

  it('seeks back ten seconds', async () => {
    const { user, engine } = await playFirstSearchResult()
    engine.emitDuration(200)
    player().setDuration(200)
    player().setCurrentTime(100)

    const dialog = await openSheet(user)
    await user.click(within(dialog).getByRole('button', { name: 'Seek back 10 seconds' }))

    await waitFor(() => expect(player().currentTime).toBe(90))
  })

  it('seeks forward ten seconds', async () => {
    const { user, engine } = await playFirstSearchResult()
    engine.emitDuration(200)
    player().setDuration(200)
    player().setCurrentTime(100)

    const dialog = await openSheet(user)
    await user.click(within(dialog).getByRole('button', { name: 'Seek forward 10 seconds' }))

    await waitFor(() => expect(player().currentTime).toBe(110))
  })

  it('disables both skip controls until a duration is known', async () => {
    const { user } = await playFirstSearchResult()
    player().setDuration(0)

    const dialog = await openSheet(user)
    expect(within(dialog).getByRole('button', { name: 'Seek back 10 seconds' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Seek forward 10 seconds' })).toBeDisabled()
  })

  it('offers a seek slider that reaches the real engine', async () => {
    const { user, engine } = await playFirstSearchResult()
    engine.emitDuration(200)
    player().setDuration(200)
    player().setCurrentTime(0)

    const dialog = await openSheet(user)
    const slider = within(dialog).getByRole('slider', { name: 'Seek' })
    slider.focus()
    await user.keyboard('{End}')

    await waitFor(() => expect(player().currentTime).toBe(200))
    expect(engine.getCurrentTime()).toBe(200)
  })

  it('gives the slider roughly one-second keyboard granularity', async () => {
    const { user, engine } = await playFirstSearchResult()
    engine.emitDuration(200)
    player().setDuration(200)
    player().setCurrentTime(100)

    const dialog = await openSheet(user)
    const slider = within(dialog).getByRole('slider', { name: 'Seek' })
    slider.focus()
    await user.keyboard('{ArrowRight}')

    // A fixed ratio step would have moved four seconds on a 200-second track.
    await waitFor(() => expect(Math.round(player().currentTime)).toBe(101))
  })

  it('shares shuffle and repeat with the bar rather than keeping its own', async () => {
    const { user } = await playFirstSearchResult()
    const dialog = await openSheet(user)

    await user.click(within(dialog).getByRole('button', { name: 'Shuffle off' }))
    expect(player().shuffle).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: 'Repeat off' }))
    expect(player().repeatMode).toBe('all')
  })

  it('opens the existing queue panel rather than drawing a second one', async () => {
    const { user } = await playFirstSearchResult()
    const dialog = await openSheet(user)

    await user.click(within(dialog).getByRole('button', { name: /Up next/i }))
    expect(await screen.findByRole('complementary', { name: 'Play queue' })).toBeInTheDocument()
  })
})

describe('a live track change', () => {
  it('updates in place when autoplay advances, without closing', async () => {
    const { user, engine } = await playFirstSearchResult()
    const dialog = await openSheet(user)
    expect(within(dialog).getByRole('heading', { name: 'Midnight Signal' })).toBeInTheDocument()

    usePlayerStore.setState({ autoplaySimilar: true })
    rememberTracks([
      {
        id: 'jamendo:next',
        mediaKind: 'audio',
        provider: 'jamendo',
        providerId: 'next',
        title: 'Follow Up',
        artistName: 'Someone Else',
        artwork: {},
        durationSeconds: 180,
        isStreamable: true,
        genre: 'House',
        streamUrl: 'https://prod.jamendo.test/stream.mp3',
      } satisfies Track,
    ])

    engine.emitEnded()

    // Still open, showing the new track — no remount, no reload of the sheet.
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Now playing' })).toBeInTheDocument(),
    )
    await waitFor(() => expect(player().currentTrack?.title).not.toBe('Midnight Signal'))
    const title = within(screen.getByRole('dialog', { name: 'Now playing' })).getByRole('heading', {
      level: 2,
    })
    expect(title.textContent).toBe(player().currentTrack?.title)
  })

  it('still shows exactly one audio element afterwards', async () => {
    const { user, engine } = await playFirstSearchResult()
    await openSheet(user)
    usePlayerStore.setState({ autoplaySimilar: true })
    engine.emitEnded()

    await waitFor(() => expect(player().currentTrack).not.toBeNull())
    expect(document.querySelectorAll('audio')).toHaveLength(0)
  })
})

describe('library integration', () => {
  it('likes the current track into the one canonical store', async () => {
    const { user } = await playFirstSearchResult()
    const dialog = await openSheet(user)

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Save Midnight Signal to Liked Songs in Pulse',
      }),
    )

    await waitFor(() =>
      expect(useLibraryStore.getState().state.likedTrackKeys).toEqual(['audius:trk1']),
    )
    // The sheet's own heart reflects it…
    expect(
      within(dialog).getByRole('button', {
        name: 'Remove Midnight Signal from Liked Songs in Pulse',
      }),
    ).toBeInTheDocument()
    // …and so does the mini-player's, because they are one component.
    expect(
      screen.getAllByRole('button', {
        name: 'Remove Midnight Signal from Liked Songs in Pulse',
      }).length,
    ).toBeGreaterThan(1)
  })

  it('offers the shared track menu, including Add to queue', async () => {
    const { user } = await playFirstSearchResult()
    const dialog = await openSheet(user)

    await user.click(
      within(dialog).getByRole('button', { name: 'More actions for Midnight Signal' }),
    )
    expect(
      screen.getByRole('menuitem', { name: 'Add Midnight Signal to the play queue' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /New playlist/i })).toBeInTheDocument()
  })
})

describe('provider attribution survives expansion', () => {
  it('keeps the Audius backlink reachable', async () => {
    const { user } = await playFirstSearchResult()
    const dialog = await openSheet(user)

    const link = within(dialog).getByRole('link', { name: /Open on Audius/i })
    expect(link).toHaveAttribute('href', expect.stringContaining('audius'))
  })

  it("keeps Jamendo's required per-item backlink, which is a licence obligation", async () => {
    const { user } = await playFirstSearchResult()

    const jamendo: Track = {
      id: 'jamendo:1880336',
      mediaKind: 'audio',
      provider: 'jamendo',
      providerId: '1880336',
      title: 'Night Reverie',
      artistName: 'Lumen Field',
      artwork: {},
      durationSeconds: 180,
      isStreamable: true,
      sourceUrl: 'https://www.jamendo.com/track/1880336/night-reverie',
      attributionRequired: true,
    }
    player().setQueue([jamendo], 0, null)

    const dialog = await openSheet(user)
    const credit = within(dialog).getByRole('link', { name: /Jamendo/i })
    expect(credit).toHaveAttribute('href', jamendo.sourceUrl)
  })
})

describe('queue precedence is unchanged while expanded', () => {
  it('plays the next playlist item rather than a generated one', async () => {
    const { user, engine } = await playFirstSearchResult()

    const item = (id: string, title: string): Track => ({
      id: `jamendo:${id}`,
      mediaKind: 'audio',
      provider: 'jamendo',
      providerId: id,
      title,
      artistName: 'List Artist',
      artwork: {},
      durationSeconds: 120,
      isStreamable: true,
      streamUrl: 'https://prod.jamendo.test/stream.mp3',
    })

    const list = [item('a', 'A'), item('b', 'B'), item('c', 'C')]
    player().setQueue(list, 0, { id: 'playlist:x', label: 'Road Trip' })
    usePlayerStore.setState({ autoplaySimilar: true })
    rememberTracks([item('generated', 'Generated')])

    await openSheet(user)
    engine.emitEnded()

    // The Phase 7 precedence still holds with the sheet on screen: the explicit
    // list wins over anything the planner would have offered.
    await waitFor(() => expect(player().currentTrack?.title).toBe('B'))
    expect(sheet()).not.toBeNull()
  })
})

describe('accessibility', () => {
  it('is a labelled modal dialog', async () => {
    const { user } = await playFirstSearchResult()
    const dialog = await openSheet(user)

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Now playing')
  })

  /**
   * Focus goes in on open and comes back out on close — to the control that
   * opens the view, which is a *fresh element* now.
   *
   * The expanded view replaces the mini-player rather than covering it, so the
   * chevron the visitor pressed is unmounted on the way up and rebuilt on the
   * way down. "The same node regains focus" is therefore the wrong assertion;
   * "the visitor ends up back on the control they pressed" is the right one, and
   * is what a keyboard user actually experiences.
   */
  it('moves focus into the sheet and back out again', async () => {
    const { user } = await playFirstSearchResult()

    const dialog = await openSheet(user)
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Collapse Now Playing' })).toHaveFocus(),
    )

    await user.keyboard('{Escape}')
    await waitFor(() => expect(sheet()).toBeNull())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open Now Playing' })).toHaveFocus(),
    )
  })

  it('names every transport control', async () => {
    const { user } = await playFirstSearchResult()
    const dialog = await openSheet(user)

    for (const name of [
      'Seek back 10 seconds',
      'Previous track',
      'Next track',
      'Seek forward 10 seconds',
    ]) {
      expect(within(dialog).getByRole('button', { name })).toBeInTheDocument()
    }
  })
})

/**
 * The sheet used to `return null` whenever a video was on screen, because the
 * video had its own floating player and two full-screen surfaces would have
 * fought for the room. There is one player now, so the sheet does not stand
 * down — it *becomes* the video's expanded view.
 */
describe('it is the expanded view for the video player too', () => {
  it('follows the engine rather than closing when a video takes over', async () => {
    const { user } = await playFirstSearchResult()
    await openSheet(user)
    expect(within(sheet()!).getByText('Midnight Signal')).toBeInTheDocument()

    await playYouTubeVideo(
      normalizeYouTubeVideo(youtubePayload({ videoId: 'vid0000001', title: 'Sourp Sarkis' })),
      { userInitiated: true },
    )

    // Still open, now showing the video — and no longer showing the track.
    await waitFor(() => expect(within(sheet()!).getByText('Sourp Sarkis')).toBeInTheDocument())
    expect(within(sheet()!).queryByText('Midnight Signal')).not.toBeInTheDocument()
  })

  /**
   * The video is the expanded view's primary media region, where a track's large
   * cover goes.
   *
   * This assertion has been written three ways, and the third is the one that
   * matches what a visitor should see. It first asserted the player was *in* the
   * sheet, which was true and meant the sheet had to be forced open before a
   * video could play at all. It then asserted the sheet did *not* contain it,
   * because the player had moved to the bar — true again, and the reason the
   * expanded view ended up stacked on top of a bar that still held the video.
   *
   * The stage is a stable child of the player shell now, so it is inside
   * whichever presentation is up, without ever being reparented. Here that is
   * the expanded one, in the slot the cover occupies for a track.
   */
  it('gives the video the primary media region, where a cover would be', async () => {
    const { user } = await playFirstSearchResult()
    await openSheet(user)
    await playYouTubeVideo(
      normalizeYouTubeVideo(youtubePayload({ videoId: 'vid0000002', title: 'Barov Ari' })),
      { userInitiated: true },
    )

    await waitFor(() => expect(within(sheet()!).getByText('Barov Ari')).toBeInTheDocument())

    const stages = screen.getAllByTestId('youtube-stage')
    expect(stages).toHaveLength(1)
    expect(sheet()!.contains(stages[0])).toBe(true)
    // It holds the API-created node and nothing else, so nothing of ours is
    // ever drawn over the player or over its native controls.
    expect(stages[0].children).toHaveLength(1)
    expect(stages[0].firstElementChild).toHaveClass('yt-stage-mount')
    // And no still artwork standing in for it beside the live one.
    expect(sheet()!.querySelector('.now-playing-art')).toBeNull()
  })

  it('keeps every control out of the player, never on top of it', async () => {
    const { user } = await playFirstSearchResult()
    await openSheet(user)
    await playYouTubeVideo(
      normalizeYouTubeVideo(youtubePayload({ videoId: 'vid0000005', title: 'Yars Ari' })),
      { userInitiated: true },
    )
    await waitFor(() => expect(within(sheet()!).getByText('Yars Ari')).toBeInTheDocument())

    const stage = screen.getByTestId('youtube-stage')
    for (const control of screen.getAllByRole('button')) {
      expect(stage.contains(control)).toBe(false)
    }
    expect(stage.contains(within(sheet()!).getByRole('slider', { name: 'Seek' }))).toBe(false)
  })

  it('withholds the queue-shaped controls a video has no answer for', async () => {
    const { user } = await playFirstSearchResult()
    await openSheet(user)
    await playYouTubeVideo(
      normalizeYouTubeVideo(youtubePayload({ videoId: 'vid0000003', title: 'Nani Im Nani' })),
      { userInitiated: true },
    )
    await waitFor(() => expect(within(sheet()!).getByText('Nani Im Nani')).toBeInTheDocument())

    const dialog = sheet()!
    // Absent, not disabled: a shuffle button over a result session would be a
    // promise the app cannot keep. A result session has no running order to
    // reorder or repeat, no queue panel behind it, and the embed's volume is the
    // visitor's own business through YouTube's native controls.
    expect(within(dialog).queryByRole('button', { name: /Shuffle/i })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Repeat/i })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Up next/i })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('slider', { name: 'Volume' })).not.toBeInTheDocument()

    /**
     * The ten-second controls are **not** in that set, and this assertion is the
     * reverse of what it used to be.
     *
     * It read `not.toBeInTheDocument()`, because the buttons were gated on
     * `can.queue` — which is not what they are about. A queue is a running
     * order; moving ten seconds inside one item has nothing to do with having
     * one. The gate merely happened to spell "audio only", and the result was a
     * transport row that changed shape depending on which engine was loaded:
     * five controls for a track, three for a video, in the same slot on the same
     * screen. That is the difference between one player and two.
     *
     * Seeking is genuinely supported here — the engine drives YouTube's own
     * documented `seekTo` — so withholding the control was not honesty about a
     * limitation, it was an inconsistency. Nothing is faked to satisfy this: the
     * controls that a video really has no answer for are still absent above.
     */
    expect(within(dialog).getByRole('button', { name: 'Seek back 10 seconds' })).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Seek forward 10 seconds' }),
    ).toBeInTheDocument()

    // What every provider does get, it still gets.
    expect(within(dialog).getByRole('slider', { name: 'Seek' })).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: /Save .* to Liked Songs/i }),
    ).toBeInTheDocument()
  })

  /**
   * Back to pausing, and this time it is the layout that is right rather than
   * the rule that changed.
   *
   * The sequence is: pause → collapse → destroy. Collapsing removes the player
   * from the page, and the policies prohibit content continuing in a player the
   * visitor cannot see, so pausing is the only honest answer to a stage that
   * goes away. The arrangement that avoided it — docking a live player beside
   * the mini-player so a video was always displayed — kept the video running and
   * made a collapsed video look like two players. Pausing costs one press;
   * the floating box cost the product its coherence.
   *
   * The position survives, which is what makes the press cheap: see
   * `ExpandedYouTubePlayer.test.tsx` for the round trip.
   */
  it('pauses the video on the way down, because the player leaves the page', async () => {
    const { user } = await playFirstSearchResult()
    await openSheet(user)
    await playYouTubeVideo(
      normalizeYouTubeVideo(youtubePayload({ videoId: 'vid0000004', title: 'Ay Kyanq' })),
      { userInitiated: true },
    )
    await waitFor(() => expect(useYouTubeStore.getState().status).toBe('playing'))

    await user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useYouTubeStore.getState().status).toBe('paused')
    // Gone from the page, not hidden on it. A parked iframe would be a live
    // player the visitor cannot see, which is the thing the pause exists for.
    expect(screen.queryByTestId('youtube-stage')).not.toBeInTheDocument()
    // The item is still loaded, so the bar shows it with a Play button.
    expect(useYouTubeStore.getState().item?.title).toBe('Ay Kyanq')
  })

  it('does not pause audio on the way down — that is only a change of view', async () => {
    const { user, engine } = await playFirstSearchResult()
    await openSheet(user)
    expect(engine.playing).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))

    await waitFor(() => expect(sheet()).toBeNull())
    expect(engine.playing).toBe(true)
  })
})
