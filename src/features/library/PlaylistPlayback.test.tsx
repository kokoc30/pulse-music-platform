import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { audiusRef, libraryWith, playlist } from '@/test/fixtures/library'
import { useLibraryStore } from '@/library/store'
import { usePlayerStore } from '@/player/player-store'
import { collectionSession } from '@/player/collection-session'
import { playNext, playPrevious } from '@/player/player-actions'

/**
 * Playing a saved playlist, through the real player.
 *
 * The point of these tests is the *absence* of a second playback path: a
 * playlist becomes the ordinary explicit queue, and every rule that already
 * governed the queue — precedence over autoplay, Media Session Next, shuffle,
 * repeat — governs it unchanged (agents/45 → "One playback path").
 *
 * References resolve through the Audius doubles in `src/test/msw/handlers.ts`,
 * which is exactly how they resolve in production: a saved item carries no
 * playable URL, so playing one re-asks the provider.
 */

/** Three real Audius ids the MSW handlers can resolve. */
const savedPlaylist = () =>
  libraryWith({
    tracks: [
      audiusRef({ key: 'audius:trk1', providerItemId: 'trk1', title: 'Midnight Signal' }),
      audiusRef({ key: 'audius:trk2', providerItemId: 'trk2', title: 'Paper Lanterns' }),
      audiusRef({ key: 'audius:trk3', providerItemId: 'trk3', title: 'No Artwork Here' }),
    ],
    playlists: [playlist({ itemKeys: ['audius:trk1', 'audius:trk2', 'audius:trk3'] })],
  })

async function hydrated() {
  await waitFor(() => expect(useLibraryStore.getState().hydrated).toBe(true))
}

const player = () => usePlayerStore.getState()
const currentTitle = () => player().currentTrack?.title
const queueTitles = () => player().queue.map((track) => track.title)

describe('Play', () => {
  it('starts the first item and makes the rest the explicit queue', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: savedPlaylist() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))

    await waitFor(() => expect(currentTitle()).toBe('Midnight Signal'))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))
    expect(queueTitles()).toEqual(['Midnight Signal', 'Paper Lanterns', 'No Artwork Here'])
    expect(player().queueContext?.label).toBe('Road Trip')
  })

  it('never persists a stream URL, however it plays', async () => {
    const { user, library: repository } = renderApp({
      route: '/playlist/pl_test',
      library: savedPlaylist(),
    })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(currentTitle()).toBe('Midnight Signal'))

    const stored = JSON.stringify(repository.raw())
    expect(stored).not.toContain('cidstream')
    expect(stored).not.toContain('signature')
    expect(stored).not.toContain('streamUrl')
  })

  it('starts at the clicked row and continues from there', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: savedPlaylist() })
    await hydrated()

    const list = await screen.findByTestId('playlist-list')
    await user.click(within(list).getByRole('button', { name: /^Play Paper Lanterns/ }))

    await waitFor(() => expect(currentTitle()).toBe('Paper Lanterns'))
    await waitFor(() => expect(player().queue.length).toBeGreaterThan(1))
    // The continuation is the playlist order from that point onward. It does not
    // rotate: with Repeat off, a list started at row two ends at the last row
    // rather than wrapping quietly back to the first.
    expect(queueTitles()).toEqual(['Paper Lanterns', 'No Artwork Here'])
  })

  it('advances through the playlist on Next', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: savedPlaylist() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))

    await playNext()
    expect(currentTitle()).toBe('Paper Lanterns')
    await playNext()
    expect(currentTitle()).toBe('No Artwork Here')
  })

  it('steps back through the playlist on Previous', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: savedPlaylist() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))

    await playNext()
    player().setCurrentTime(0)
    await playPrevious()
    expect(currentTitle()).toBe('Midnight Signal')
  })
})

describe('an item the provider no longer has', () => {
  it('is skipped rather than stopping the playlist', async () => {
    const state = libraryWith({
      tracks: [
        audiusRef({ key: 'audius:gone', providerItemId: 'gone', title: 'Withdrawn' }),
        audiusRef({ key: 'audius:trk1', providerItemId: 'trk1', title: 'Midnight Signal' }),
      ],
      playlists: [playlist({ itemKeys: ['audius:gone', 'audius:trk1'] })],
    })
    const { user } = renderApp({ route: '/playlist/pl_test', library: state })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))

    await waitFor(() => expect(currentTitle()).toBe('Midnight Signal'))
  })

  it('stays visible in the list so it can be removed', async () => {
    const state = libraryWith({
      tracks: [audiusRef({ key: 'audius:gone', providerItemId: 'gone', title: 'Withdrawn' })],
      playlists: [playlist({ itemKeys: ['audius:gone'] })],
    })
    renderApp({ route: '/playlist/pl_test', library: state })
    await hydrated()

    expect(await screen.findByText('Withdrawn')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions for Withdrawn' })).toBeInTheDocument()
  })

  it('says so honestly when nothing in the list can play', async () => {
    const state = libraryWith({
      tracks: [audiusRef({ key: 'audius:gone', providerItemId: 'gone', title: 'Withdrawn' })],
      playlists: [playlist({ itemKeys: ['audius:gone'] })],
    })
    const { user } = renderApp({ route: '/playlist/pl_test', library: state })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    expect(await screen.findByRole('status')).toHaveTextContent(/aren't available to stream/i)
  })
})

describe('Shuffle', () => {
  it('turns shuffle on and leaves the stored order untouched', async () => {
    const { user, library: repository } = renderApp({
      route: '/playlist/pl_test',
      library: savedPlaylist(),
    })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /Shuffle/ }))
    await waitFor(() => expect(player().shuffle).toBe(true))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))

    const stored = repository.raw()!.playlists as Record<string, { itemKeys: string[] }>
    expect(stored.pl_test.itemKeys).toEqual(['audius:trk1', 'audius:trk2', 'audius:trk3'])
    expect(useLibraryStore.getState().state.playlists.pl_test.itemKeys).toEqual([
      'audius:trk1',
      'audius:trk2',
      'audius:trk3',
    ])
  })

  it('keeps the rows on screen in the playlist order while shuffled playback runs', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: savedPlaylist() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /Shuffle/ }))
    await waitFor(() => expect(player().shuffle).toBe(true))

    const titles = within(screen.getByTestId('playlist-list'))
      .getAllByRole('button', { name: /^Play /i })
      .map((node) => node.getAttribute('aria-label'))
    expect(titles[0]).toContain('Midnight Signal')
    expect(titles[1]).toContain('Paper Lanterns')
  })

  it('holds one running order for the session', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: savedPlaylist() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /Shuffle/ }))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))

    // The permutation belongs to the collection session now, which is what lets
    // it survive an engine change; the queue is materialized in it, so what is
    // asserted is that neither is redrawn by an advance.
    const order = [...collectionSession().order]
    const queue = [...queueTitles()]
    expect([...order].sort()).toEqual([0, 1, 2])

    await playNext()
    expect(collectionSession().order).toEqual(order)
    expect(queueTitles()).toEqual(queue)
  })

  it('is turned off again by pressing Play', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: savedPlaylist() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /Shuffle/ }))
    await waitFor(() => expect(player().shuffle).toBe(true))

    await user.click(screen.getByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(player().shuffle).toBe(false))
  })
})

describe('the playlist outranks generated autoplay', () => {
  it('plays the next saved item rather than a similar one', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: savedPlaylist() })
    await hydrated()

    usePlayerStore.setState({ autoplaySimilar: true })
    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))

    await playNext()
    expect(currentTitle()).toBe('Paper Lanterns')
    // Still the saved list, not something the app invented.
    expect(queueTitles()).toEqual(['Midnight Signal', 'Paper Lanterns', 'No Artwork Here'])
  })

  it('loops instead of generating when Repeat playlist is on', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: savedPlaylist() })
    await hydrated()

    usePlayerStore.setState({ autoplaySimilar: true })
    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(queueTitles()).toHaveLength(3))

    usePlayerStore.getState().setRepeatMode('all')
    await playNext()
    await playNext()
    await playNext()

    expect(currentTitle()).toBe('Midnight Signal')
  })
})

describe('Liked Songs plays the same way', () => {
  it('becomes the queue with no separate code path', async () => {
    const { user } = renderApp({
      route: '/library/liked',
      library: libraryWith({
        tracks: [
          audiusRef({ key: 'audius:trk1', providerItemId: 'trk1', title: 'Midnight Signal' }),
          audiusRef({ key: 'audius:trk2', providerItemId: 'trk2', title: 'Paper Lanterns' }),
        ],
        liked: ['audius:trk1', 'audius:trk2'],
      }),
    })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(currentTitle()).toBe('Midnight Signal'))
    await waitFor(() => expect(player().queue).toHaveLength(2))
    expect(player().queueContext?.label).toBe('Liked Songs')
  })
})

describe('removing the track that is playing', () => {
  it('does not interrupt playback', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: savedPlaylist() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(currentTitle()).toBe('Midnight Signal'))

    useLibraryStore.getState().removeFromPlaylist('pl_test', 'audius:trk1')

    await waitFor(() =>
      expect(useLibraryStore.getState().state.playlists.pl_test.itemKeys).not.toContain(
        'audius:trk1',
      ),
    )
    // The queue is a snapshot of what the visitor asked to hear; editing the
    // saved list does not reach in and stop the music.
    expect(currentTitle()).toBe('Midnight Signal')
    expect(player().status).not.toBe('idle')
  })
})
