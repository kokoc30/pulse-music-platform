import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { useLibraryStore } from '@/library/store'
import { usePlayerStore } from '@/player/player-store'
import { useYouTubeStore } from '@/player/youtube-store'
import { rememberTracks } from '@/player/autoplay'
import type { Track } from '@/music/types'

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

  it('leaves the mini-player in place underneath', async () => {
    const { user } = await playFirstSearchResult()
    await openSheet(user)
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

  it('moves focus into the sheet and back out again', async () => {
    const { user } = await playFirstSearchResult()
    const trigger = screen.getByRole('button', { name: 'Open Now Playing' })

    const dialog = await openSheet(user)
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Collapse Now Playing' })).toHaveFocus(),
    )

    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
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

describe('it never competes with the video player', () => {
  it('stands down while the video surface is open', async () => {
    const { user } = await playFirstSearchResult()
    await openSheet(user)

    useYouTubeStore.setState({ surfaceOpen: true })

    await waitFor(() => expect(sheet()).toBeNull())
  })
})
