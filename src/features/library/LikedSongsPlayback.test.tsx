import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { audiusRef, libraryWith } from '@/test/fixtures/library'
import { useLibraryStore } from '@/library/store'
import { collectionSession } from '@/player/collection-session'
import { playNext, playPrevious, skipToNext } from '@/player/player-actions'
import { usePlayerStore } from '@/player/player-store'

/**
 * Liked Songs, played from the page a visitor actually uses.
 *
 * The unit suite in `player/collection-playback.test.ts` proves the session
 * rules; this one proves the page is wired to them — that the rows it hands over
 * are the rows on screen, in the order on screen, and that the two hero buttons
 * and a row click are the same implementation rather than three.
 *
 * References resolve through the Audius doubles in `src/test/msw/handlers.ts`,
 * exactly as they do in production: a saved item carries no playable URL, so
 * playing one re-asks the provider.
 */

const liked = () =>
  libraryWith({
    tracks: [
      audiusRef({ key: 'audius:trk1', providerItemId: 'trk1', title: 'Midnight Signal' }),
      audiusRef({ key: 'audius:trk2', providerItemId: 'trk2', title: 'Paper Lanterns' }),
      audiusRef({ key: 'audius:trk3', providerItemId: 'trk3', title: 'No Artwork Here' }),
    ],
    // Most recently liked first, which is the default sort.
    liked: ['audius:trk1', 'audius:trk2', 'audius:trk3'],
  })

async function hydrated() {
  await waitFor(() => expect(useLibraryStore.getState().hydrated).toBe(true))
}

const player = () => usePlayerStore.getState()
const current = () => player().currentTrack?.title
const queueTitles = () => player().queue.map((track) => track.title)

const rowFor = (name: RegExp) =>
  within(screen.getByTestId('liked-list')).getByRole('button', { name })

describe('clicking a row', () => {
  it('plays it and continues into the songs below it', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play Midnight Signal/ }))
    await waitFor(() => expect(current()).toBe('Midnight Signal'))

    await playNext()
    expect(current()).toBe('Paper Lanterns')
    await playNext()
    expect(current()).toBe('No Artwork Here')
  })

  it('starts in the middle without pulling the songs above it along', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()
    // Autoplay off, so anything that plays after the list can only be the list.
    usePlayerStore.setState({ autoplaySimilar: false })

    await user.click(rowFor(/^Play Paper Lanterns/))
    await waitFor(() => expect(current()).toBe('Paper Lanterns'))

    await playNext()
    expect(current()).toBe('No Artwork Here')

    // Repeat is off, so the list ends here rather than wrapping to the first row.
    await playNext()
    expect(current()).toBe('No Artwork Here')
  })

  it('reports Liked Songs as the context, never Search or Autoplay', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.click(rowFor(/^Play Paper Lanterns/))
    await waitFor(() => expect(current()).toBe('Paper Lanterns'))

    expect(player().queueContext).toEqual({ id: 'library:liked', label: 'Liked Songs' })
  })
})

describe('the Play button', () => {
  it('starts at the first visible row and builds the same session', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(current()).toBe('Midnight Signal'))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))

    expect(queueTitles()).toEqual(['Midnight Signal', 'Paper Lanterns', 'No Artwork Here'])
    expect(collectionSession().context?.id).toBe('library:liked')
  })
})

describe('the sort control', () => {
  it('decides the order playback follows', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.selectOptions(await screen.findByLabelText('Sort Liked Songs'), 'title')

    // By title: Midnight Signal, No Artwork Here, Paper Lanterns.
    await user.click(rowFor(/^Play No Artwork Here/))
    await waitFor(() => expect(current()).toBe('No Artwork Here'))

    await playNext()
    expect(current()).toBe('Paper Lanterns')
  })
})

describe('the filter', () => {
  it('is what plays: hidden rows are not inserted into the continuation', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.type(await screen.findByLabelText('Find in Liked Songs'), 'n')
    // "Midnight Signal", "Paper Lanterns" and "No Artwork Here" all match an "n";
    // narrow to the two that carry "an".
    await user.clear(screen.getByLabelText('Find in Liked Songs'))
    await user.type(screen.getByLabelText('Find in Liked Songs'), 'lanterns')

    await waitFor(() =>
      expect(
        within(screen.getByTestId('liked-list')).getAllByRole('button', { name: /^Play /i }),
      ).toHaveLength(1),
    )

    await user.click(rowFor(/^Play Paper Lanterns/))
    await waitFor(() => expect(current()).toBe('Paper Lanterns'))

    // The session is exactly what was on screen.
    expect(collectionSession().items.map((item) => item.title)).toEqual(['Paper Lanterns'])
  })
})

describe('Shuffle', () => {
  it('draws one running order over every visible row and keeps the stored order', async () => {
    const { user, library: repository } = renderApp({
      route: '/library/liked',
      library: liked(),
    })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /Shuffle/ }))
    await waitFor(() => expect(player().shuffle).toBe(true))
    await waitFor(() => expect(collectionSession().order).toHaveLength(3))

    expect([...collectionSession().order].sort()).toEqual([0, 1, 2])

    // Liked Songs membership is untouched, in the store and on disk.
    expect(useLibraryStore.getState().state.likedTrackKeys).toEqual([
      'audius:trk1',
      'audius:trk2',
      'audius:trk3',
    ])
    expect((repository.raw() as { likedTrackKeys: string[] }).likedTrackKeys).toEqual([
      'audius:trk1',
      'audius:trk2',
      'audius:trk3',
    ])
  })

  it('follows that one order rather than redrawing it on each Next', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /Shuffle/ }))
    await waitFor(() => expect(collectionSession().order).toHaveLength(3))

    const order = [...collectionSession().order]
    await playNext()
    await playNext()
    expect(collectionSession().order).toEqual(order)
  })

  it('leaves the rows on screen in the visible order while shuffled playback runs', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /Shuffle/ }))
    await waitFor(() => expect(player().shuffle).toBe(true))

    const titles = within(screen.getByTestId('liked-list'))
      .getAllByRole('button', { name: /^Play /i })
      .map((node) => node.getAttribute('aria-label'))
    expect(titles[0]).toContain('Midnight Signal')
    expect(titles[1]).toContain('Paper Lanterns')
    expect(titles[2]).toContain('No Artwork Here')
  })
})

describe('Repeat', () => {
  it('playlist wraps the whole collection', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))
    player().setRepeatMode('all')

    await playNext()
    await playNext()
    await playNext()
    expect(current()).toBe('Midnight Signal')
  })

  it('one replays on a natural end and steps on for a press of Next', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(current()).toBe('Midnight Signal'))
    player().setRepeatMode('one')

    await playNext()
    expect(current()).toBe('Midnight Signal')

    await skipToNext()
    expect(current()).toBe('Paper Lanterns')
  })
})

describe('editing the library while it plays', () => {
  it('keeps playing the song that was unliked', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.click(rowFor(/^Play Paper Lanterns/))
    await waitFor(() => expect(current()).toBe('Paper Lanterns'))

    useLibraryStore
      .getState()
      .toggleLiked(
        audiusRef({ key: 'audius:trk2', providerItemId: 'trk2', title: 'Paper Lanterns' }),
      )
    await waitFor(() =>
      expect(useLibraryStore.getState().state.likedTrackKeys).not.toContain('audius:trk2'),
    )

    // The session is a snapshot of what the listener started.
    expect(current()).toBe('Paper Lanterns')
    expect(player().status).not.toBe('idle')

    await playNext()
    expect(current()).toBe('No Artwork Here')
  })

  it('does not rewrite the running session when a later song is unliked', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))

    useLibraryStore
      .getState()
      .toggleLiked(
        audiusRef({ key: 'audius:trk3', providerItemId: 'trk3', title: 'No Artwork Here' }),
      )

    await playNext()
    await playNext()
    expect(current()).toBe('No Artwork Here')
  })
})

describe('Previous', () => {
  it('steps back through the visible order', async () => {
    const { user } = renderApp({ route: '/library/liked', library: liked() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))

    await playNext()
    expect(current()).toBe('Paper Lanterns')

    player().setCurrentTime(0)
    await playPrevious()
    expect(current()).toBe('Midnight Signal')
  })
})
