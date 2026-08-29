import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import {
  audiusRef,
  jamendoRef,
  libraryWith,
  playlist,
  youtubeRef,
  FIXED_NOW,
} from '@/test/fixtures/library'
import { useLibraryStore } from '@/library/store'
import { LIBRARY_ROUTES } from '@/library/library-actions'
import { createEmptyLibrary } from '@/library/types'

/**
 * Your Library, through the real app shell.
 *
 * These drive the product the way a visitor does — press the heart on a search
 * row, open the menu, create a playlist, reorder it, reload — rather than
 * calling the store. Anything that only the store can express is tested in
 * `store.test.ts`; this file is about what actually reaches the screen.
 */

const library = () => useLibraryStore.getState().state

/** Waits for the asynchronous IndexedDB-shaped hydration to settle. */
async function hydrated() {
  await waitFor(() => expect(useLibraryStore.getState().hydrated).toBe(true))
}

const seeded = () =>
  libraryWith({
    tracks: [audiusRef(), jamendoRef()],
    liked: ['audius:t1'],
    playlists: [playlist({ itemKeys: ['jamendo:1880336', 'audius:t1'] })],
  })

describe('/library', () => {
  it('shows Liked Songs and the playlists saved on this device', async () => {
    renderApp({ route: LIBRARY_ROUTES.library, library: seeded() })
    await hydrated()

    expect(await screen.findByRole('heading', { name: 'Your Library' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Liked Songs' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Road Trip' })).toBeInTheDocument()
    expect(screen.getByText('2 songs')).toBeInTheDocument()
  })

  it('says so plainly when there are no playlists yet', async () => {
    renderApp({ route: LIBRARY_ROUTES.library })
    await hydrated()

    expect(await screen.findByText('No playlists yet')).toBeInTheDocument()
    expect(screen.getByText('Create a playlist to keep music together.')).toBeInTheDocument()
  })

  it('creates a playlist and opens it', async () => {
    const { user } = renderApp({ route: LIBRARY_ROUTES.library })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /New playlist/i }))
    await user.type(screen.getByLabelText('Playlist name'), 'Road Trip')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Road Trip' })).toBeInTheDocument(),
    )
    expect(Object.values(library().playlists)[0].name).toBe('Road Trip')
  })

  it('filters locally, with no provider request', async () => {
    const { user } = renderApp({ route: LIBRARY_ROUTES.library, library: seeded() })
    await hydrated()

    await user.type(await screen.findByLabelText('Find in your library'), 'road')
    expect(screen.getByRole('heading', { name: 'Road Trip' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Liked Songs' })).toBeNull()
  })

  it('sorts playlists by the chosen order', async () => {
    const { user } = renderApp({
      route: LIBRARY_ROUTES.library,
      library: libraryWith({
        playlists: [
          playlist({ id: 'pl_b', name: 'Beta', createdAt: FIXED_NOW, updatedAt: FIXED_NOW + 10 }),
          playlist({ id: 'pl_a', name: 'Alpha', createdAt: FIXED_NOW + 5, updatedAt: FIXED_NOW }),
        ],
      }),
    })
    await hydrated()

    const names = () =>
      screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)

    await waitFor(() => expect(names()).toContain('Beta'))
    // Recently updated: Beta first.
    expect(names().indexOf('Beta')).toBeLessThan(names().indexOf('Alpha'))

    await user.selectOptions(screen.getByLabelText('Sort playlists'), 'name')
    await waitFor(() => expect(names().indexOf('Alpha')).toBeLessThan(names().indexOf('Beta')))
  })
})

describe('/library/liked', () => {
  it('lists the liked songs with their provider credit', async () => {
    renderApp({ route: LIBRARY_ROUTES.liked, library: seeded() })
    await hydrated()

    const list = await screen.findByTestId('liked-list')
    expect(within(list).getByText('Neon Corridor')).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: /Open Neon Corridor on Audius/i })).toBeInTheDocument()
  })

  it('offers no way to rename or delete it, because it is not a playlist', async () => {
    renderApp({ route: LIBRARY_ROUTES.liked, library: seeded() })
    await hydrated()

    await screen.findByRole('heading', { name: 'Liked Songs' })
    expect(screen.queryByRole('button', { name: /Edit details/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Delete$/i })).toBeNull()
  })

  it('says what to do when it is empty', async () => {
    renderApp({ route: LIBRARY_ROUTES.liked })
    await hydrated()

    expect(await screen.findByText('Songs you like will appear here.')).toBeInTheDocument()
  })

  it('sorts by title on request', async () => {
    const { user } = renderApp({
      route: LIBRARY_ROUTES.liked,
      library: libraryWith({
        tracks: [audiusRef({ title: 'Zebra' }), jamendoRef({ title: 'Apple' })],
        liked: ['audius:t1', 'jamendo:1880336'],
      }),
    })
    await hydrated()

    const titles = () =>
      within(screen.getByTestId('liked-list'))
        .getAllByRole('button', { name: /^Play /i })
        .map((node) => node.getAttribute('aria-label'))

    await waitFor(() => expect(titles()[0]).toContain('Zebra'))
    await user.selectOptions(screen.getByLabelText('Sort Liked Songs'), 'title')
    await waitFor(() => expect(titles()[0]).toContain('Apple'))
  })
})

describe('the heart', () => {
  it('says it is a Pulse action, never a provider one', async () => {
    renderApp({ route: LIBRARY_ROUTES.liked, library: seeded() })
    await hydrated()

    const heart = await screen.findByRole('button', {
      name: 'Remove Neon Corridor from Liked Songs in Pulse',
    })
    expect(heart).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggles, persists immediately, and survives a reload', async () => {
    const { user, library: repository } = renderApp({
      route: LIBRARY_ROUTES.liked,
      library: seeded(),
    })
    await hydrated()

    await user.click(
      await screen.findByRole('button', { name: 'Remove Neon Corridor from Liked Songs in Pulse' }),
    )

    await waitFor(() => expect(library().likedTrackKeys).toEqual([]))
    await waitFor(() => expect((repository.raw()!.likedTrackKeys as string[])).toEqual([]))
  })

  it('shows the same state on every surface at once', async () => {
    const { user } = renderApp({ route: LIBRARY_ROUTES.liked, library: seeded() })
    await hydrated()

    // The sidebar count is a second reader of the same store.
    const sidebarRow = () =>
      screen
        .getAllByRole('link', { name: /Liked Songs/i })
        .find((node) => node.classList.contains('sidebar-library-row'))
    await waitFor(() => expect(sidebarRow()).toHaveTextContent('1'))

    await user.click(
      await screen.findByRole('button', { name: 'Remove Neon Corridor from Liked Songs in Pulse' }),
    )

    await waitFor(() => expect(sidebarRow()).toHaveTextContent('0'))
  })

  it('reports the action in words the visitor can check', async () => {
    const { user } = renderApp({ route: LIBRARY_ROUTES.liked, library: seeded() })
    await hydrated()

    await user.click(
      await screen.findByRole('button', { name: 'Remove Neon Corridor from Liked Songs in Pulse' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Removed from Liked Songs')
  })
})

describe('add to playlist', () => {
  it('adds from a row menu without any network request', async () => {
    const { user } = renderApp({
      route: LIBRARY_ROUTES.liked,
      library: libraryWith({
        tracks: [audiusRef()],
        liked: ['audius:t1'],
        playlists: [playlist()],
      }),
    })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: 'More actions for Neon Corridor' }))
    await user.click(
      screen.getByRole('menuitem', { name: 'Add Neon Corridor to Road Trip in Pulse' }),
    )

    await waitFor(() => expect(library().playlists.pl_test.itemKeys).toEqual(['audius:t1']))
    expect(await screen.findByRole('status')).toHaveTextContent('Added to Road Trip')
  })

  it('shows an item already present as already added, and refuses to duplicate it', async () => {
    const { user } = renderApp({
      route: LIBRARY_ROUTES.liked,
      library: libraryWith({
        tracks: [audiusRef()],
        liked: ['audius:t1'],
        playlists: [playlist({ itemKeys: ['audius:t1'] })],
      }),
    })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: 'More actions for Neon Corridor' }))
    const entry = screen.getByRole('menuitem', {
      name: 'Neon Corridor is already in Road Trip',
    })
    expect(entry).toBeDisabled()
    expect(within(entry).getByText('Already added')).toBeInTheDocument()
  })

  it('creates a new playlist and adds the track in one step', async () => {
    const { user } = renderApp({
      route: LIBRARY_ROUTES.liked,
      library: libraryWith({ tracks: [audiusRef()], liked: ['audius:t1'] }),
    })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: 'More actions for Neon Corridor' }))
    await user.click(screen.getByRole('menuitem', { name: /New playlist/i }))
    await user.type(screen.getByLabelText('New playlist name'), 'Late Night')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      const created = Object.values(library().playlists)[0]
      expect(created.name).toBe('Late Night')
      expect(created.itemKeys).toEqual(['audius:t1'])
    })
  })

  it('closes on Escape without saving anything', async () => {
    const { user } = renderApp({
      route: LIBRARY_ROUTES.liked,
      library: libraryWith({
        tracks: [audiusRef()],
        liked: ['audius:t1'],
        playlists: [playlist()],
      }),
    })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: 'More actions for Neon Corridor' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(library().playlists.pl_test.itemKeys).toEqual([])
  })
})

describe('/playlist/:playlistId', () => {
  const threeTrack = () =>
    libraryWith({
      tracks: [
        audiusRef({ key: 'audius:a', providerItemId: 'a', title: 'Alpha' }),
        audiusRef({ key: 'audius:b', providerItemId: 'b', title: 'Bravo' }),
        audiusRef({ key: 'audius:c', providerItemId: 'c', title: 'Charlie' }),
      ],
      playlists: [playlist({ itemKeys: ['audius:a', 'audius:b', 'audius:c'] })],
    })

  const rowTitles = () =>
    within(screen.getByTestId('playlist-list'))
      .getAllByRole('button', { name: /^Play /i })
      .map((node) => node.getAttribute('aria-label')?.replace(/^Play /, '').split(' by ')[0])

  it('shows the playlist with its own custom order', async () => {
    renderApp({ route: '/playlist/pl_test', library: threeTrack() })
    await hydrated()

    await screen.findByTestId('playlist-list')
    expect(rowTitles()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(screen.getByText(/3 songs/)).toBeInTheDocument()
  })

  it('reorders from the keyboard-accessible menu and persists it', async () => {
    const { user, library: repository } = renderApp({
      route: '/playlist/pl_test',
      library: threeTrack(),
    })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: 'More actions for Alpha' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))

    await waitFor(() => expect(rowTitles()).toEqual(['Bravo', 'Alpha', 'Charlie']))
    await waitFor(() => {
      const stored = repository.raw()!.playlists as Record<string, { itemKeys: string[] }>
      expect(stored.pl_test.itemKeys).toEqual(['audius:b', 'audius:a', 'audius:c'])
    })
  })

  it('moves to top and to bottom', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: threeTrack() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: 'More actions for Charlie' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move to top' }))
    await waitFor(() => expect(rowTitles()).toEqual(['Charlie', 'Alpha', 'Bravo']))

    await user.click(screen.getByRole('button', { name: 'More actions for Charlie' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move to bottom' }))
    await waitFor(() => expect(rowTitles()).toEqual(['Alpha', 'Bravo', 'Charlie']))
  })

  it('disables the moves that would go nowhere', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: threeTrack() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: 'More actions for Alpha' }))
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeEnabled()
  })

  it('removes a track from the playlist without unliking it', async () => {
    const state = threeTrack()
    state.likedTrackKeys = ['audius:a']
    const { user } = renderApp({ route: '/playlist/pl_test', library: state })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: 'More actions for Alpha' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove from this playlist' }))

    await waitFor(() => expect(library().playlists.pl_test.itemKeys).toEqual(['audius:b', 'audius:c']))
    expect(library().likedTrackKeys).toEqual(['audius:a'])
  })

  it('renames and describes the playlist', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: threeTrack() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /Edit details/i }))
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Դանդաղ երգեր')
    await user.type(screen.getByLabelText('Description'), 'Slow ones')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(library().playlists.pl_test.name).toBe('Դանդաղ երգեր'))
    expect(library().playlists.pl_test.description).toBe('Slow ones')
    expect(await screen.findByRole('heading', { name: 'Դանդաղ երգեր' })).toBeInTheDocument()
  })

  it('requires a confirmation before deleting, and keeps the likes', async () => {
    const state = threeTrack()
    state.likedTrackKeys = ['audius:a']
    const { user } = renderApp({ route: '/playlist/pl_test', library: state })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /Delete/i }))
    // Nothing has happened yet.
    expect(library().playlists.pl_test).toBeDefined()
    expect(screen.getByText(/Delete “Road Trip”\?/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete playlist' }))
    await waitFor(() => expect(library().playlists.pl_test).toBeUndefined())
    expect(library().likedTrackKeys).toEqual(['audius:a'])
  })

  it('can be cancelled', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: threeTrack() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /Delete/i }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(library().playlists.pl_test).toBeDefined()
    expect(screen.queryByText(/Delete “Road Trip”\?/)).toBeNull()
  })

  it('explains a link that does not resolve on this device', async () => {
    renderApp({ route: '/playlist/pl_from_another_browser' })
    await hydrated()

    expect(await screen.findByText('That playlist is not here')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Your Library' })).toBeInTheDocument()
  })

  it('says what to do when it is empty', async () => {
    renderApp({ route: '/playlist/pl_test', library: libraryWith({ playlists: [playlist()] }) })
    await hydrated()

    expect(
      await screen.findByText('Add songs from Search, Home or Recently Played.'),
    ).toBeInTheDocument()
  })

  it('hides reordering while a filter is applied, since positions would be wrong', async () => {
    const { user } = renderApp({ route: '/playlist/pl_test', library: threeTrack() })
    await hydrated()

    await user.type(await screen.findByLabelText('Find in this playlist'), 'alpha')
    await waitFor(() => expect(rowTitles()).toEqual(['Alpha']))

    await user.click(screen.getByRole('button', { name: 'More actions for Alpha' }))
    expect(screen.queryByRole('menuitem', { name: 'Move down' })).toBeNull()
    expect(screen.getByText(/Reordering is available in the full list/)).toBeInTheDocument()
  })
})

describe('a saved YouTube item', () => {
  it('renders with YouTube attribution and its own thumbnail shape', async () => {
    renderApp({
      route: LIBRARY_ROUTES.liked,
      library: libraryWith({
        tracks: [youtubeRef({ metadataUpdatedAt: Date.now() })],
        liked: ['youtube:aaaaaaaaaaa'],
      }),
    })
    await hydrated()

    const list = await screen.findByTestId('liked-list')
    expect(within(list).getByRole('link', { name: /Open Qele Qele on YouTube/i })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    )
    expect(list.querySelector('.library-row-video')).not.toBeNull()
  })

  it('is gone entirely once its 30 days are up', async () => {
    renderApp({
      route: LIBRARY_ROUTES.liked,
      library: libraryWith({
        tracks: [
          audiusRef(),
          youtubeRef({ metadataUpdatedAt: Date.now() - 40 * 86_400_000 }),
        ],
        liked: ['youtube:aaaaaaaaaaa', 'audius:t1'],
      }),
    })
    await hydrated()

    await screen.findByTestId('liked-list')
    expect(screen.queryByText('Qele Qele')).toBeNull()
    expect(screen.getByText('Neon Corridor')).toBeInTheDocument()
    expect(library().likedTrackKeys).toEqual(['audius:t1'])
  })
})

describe('navigation', () => {
  it('reaches the library from the sidebar', async () => {
    const { user } = renderApp({ route: '/', library: seeded() })
    await hydrated()

    await user.click(
      (await screen.findAllByRole('link', { name: /Your Library/i }))[0],
    )
    expect(await screen.findByRole('heading', { name: 'Your Library' })).toBeInTheDocument()
  })

  it('lists the saved playlists in the sidebar, capped so the panel cannot grow', async () => {
    renderApp({
      route: '/',
      library: libraryWith({
        playlists: Array.from({ length: 9 }, (_, index) =>
          playlist({ id: `pl_${index}`, name: `List ${index}` }),
        ),
      }),
    })
    await hydrated()

    await waitFor(() =>
      expect(document.querySelectorAll('.sidebar-library-row').length).toBe(5),
    )
    expect(screen.getByRole('link', { name: 'See all playlists' })).toBeInTheDocument()
  })
})

describe('storage that will not persist', () => {
  it('warns once, without blocking anything', async () => {
    const { library: repository } = renderApp({ route: LIBRARY_ROUTES.library })
    repository.setWritable(false)
    await hydrated()

    useLibraryStore.getState().like(audiusRef())
    await waitFor(() => expect(useLibraryStore.getState().storageAvailable).toBe(false))

    expect(
      await screen.findByText(/not letting Pulse store anything/i),
    ).toBeInTheDocument()
    // The like still worked for this session.
    expect(library().likedTrackKeys).toEqual(['audius:t1'])
  })
})

describe('an empty library is a valid one', () => {
  it('renders every route without a stored record', async () => {
    for (const route of [LIBRARY_ROUTES.library, LIBRARY_ROUTES.liked]) {
      const { unmount } = renderApp({ route, library: createEmptyLibrary(FIXED_NOW) })
      await hydrated()
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
      unmount()
    }
  })
})
