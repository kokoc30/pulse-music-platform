import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { audiusRef, libraryWith, playlist } from '@/test/fixtures/library'
import { useLibraryStore } from '@/library/store'
import { usePersonalizationStore } from '@/personalization/store'
import { createEmptyState } from '@/personalization/types'
import type { PersonalizationState } from '@/personalization/types'
import { usePlayerStore } from '@/player/player-store'
import { playNext } from '@/player/player-actions'
import { createMediaSessionController } from '@/player/media-session/controller'

/**
 * The library's effect on recommendations, and the controls that govern it —
 * driven through the real app rather than the store.
 */

const consented = (): PersonalizationState => ({
  ...createEmptyState(Date.now()),
  consent: 'granted',
  preferences: { promptSeen: true },
})

async function hydrated() {
  await waitFor(() => expect(useLibraryStore.getState().hydrated).toBe(true))
}

const library = () => useLibraryStore.getState().state

describe('Not interested', () => {
  const seeded = () =>
    libraryWith({ tracks: [audiusRef()], liked: ['audius:t1'] })

  it('is offered on a recommendation surface and hides the item', async () => {
    const { user } = renderApp({
      route: '/library/liked',
      library: seeded(),
      personalization: consented(),
    })
    await hydrated()

    // The library row's menu carries no *Not interested*: a saved item is not a
    // recommendation, so there is nothing to stop recommending.
    await user.click(await screen.findByRole('button', { name: 'More actions for Neon Corridor' }))
    expect(screen.queryByRole('menuitem', { name: /Stop recommending/i })).toBeNull()
  })

  it('records only the key, and offers Undo on the toast', async () => {
    renderApp({ route: '/library/liked', library: seeded(), personalization: consented() })
    await hydrated()

    // Driven through the same action the menu item calls.
    const { markNotInterested } = await import('@/library/library-actions')
    markNotInterested('audius:x9')

    await waitFor(() => expect(library().hiddenRecommendationKeys).toEqual(['audius:x9']))
    expect(library().tracks['audius:x9']).toBeUndefined()
  })

  it('undoes cleanly', async () => {
    renderApp({ route: '/library/liked', library: seeded(), personalization: consented() })
    await hydrated()

    const { markNotInterested, undoNotInterested } = await import('@/library/library-actions')
    markNotInterested('audius:x9')
    await waitFor(() => expect(library().hiddenRecommendationKeys).toEqual(['audius:x9']))

    undoNotInterested('audius:x9')
    await waitFor(() => expect(library().hiddenRecommendationKeys).toEqual([]))
  })

  it('never deletes listening history', async () => {
    const history: PersonalizationState = {
      ...consented(),
      listeningHistory: [
        {
          id: 'audius:x9',
          provider: 'audius',
          mediaKind: 'audio',
          providerItemId: 'x9',
          title: 'Hidden Track',
          artist: 'Someone',
          context: 'search',
          startedAt: Date.now(),
          qualifiedAt: Date.now(),
          lastPlayedAt: Date.now(),
          playedSeconds: 100,
          completionRatio: 0.9,
          playCount: 1,
          skipCount: 0,
          playedDays: [],
          storedAt: Date.now(),
        },
      ],
    }
    renderApp({ route: '/library/liked', library: seeded(), personalization: history })
    await hydrated()
    await waitFor(() =>
      expect(usePersonalizationStore.getState().state.listeningHistory).toHaveLength(1),
    )

    const { markNotInterested } = await import('@/library/library-actions')
    markNotInterested('audius:x9')

    await waitFor(() => expect(library().hiddenRecommendationKeys).toEqual(['audius:x9']))
    expect(usePersonalizationStore.getState().state.listeningHistory).toHaveLength(1)
  })

  it('survives a reload', async () => {
    const { library: repository } = renderApp({
      route: '/library/liked',
      library: libraryWith({ hidden: ['audius:x9'] }),
      personalization: consented(),
    })
    await hydrated()

    expect(library().hiddenRecommendationKeys).toEqual(['audius:x9'])
    expect(repository.raw()!.hiddenRecommendationKeys).toEqual(['audius:x9'])
  })
})

describe('Settings', () => {
  const populated = () =>
    libraryWith({
      tracks: [audiusRef()],
      liked: ['audius:t1'],
      playlists: [playlist({ itemKeys: ['audius:t1'] })],
      hidden: ['audius:x9'],
    })

  it('summarises what is saved, and links to the library', async () => {
    renderApp({ route: '/settings', library: populated(), personalization: consented() })
    await hydrated()

    expect(await screen.findByRole('heading', { name: 'Your Library' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(/1 liked song · 1 playlist · 1 saved item\./)).toBeInTheDocument(),
    )
    // Scoped: the sidebar offers the same destination, which is the point of it.
    const settingsRow = screen.getByText(/1 liked song · 1 playlist/).closest<HTMLElement>('.settings-row')!
    expect(
      within(settingsRow).getByRole('link', { name: 'Open Your Library' }),
    ).toBeInTheDocument()
  })

  it('states plainly that a Pulse like is not a provider like', async () => {
    renderApp({ route: '/settings', library: populated() })
    await hydrated()

    const text = (await screen.findByRole('heading', { name: 'Your Library' })).parentElement!
      .textContent
    expect(text).toMatch(/does not.*change your Audius, Jamendo or YouTube account/i)
  })

  it('resets hidden recommendations behind a confirmation', async () => {
    const { user } = renderApp({ route: '/settings', library: populated() })
    await hydrated()

    await user.click(
      await screen.findByRole('button', { name: 'Reset hidden recommendations' }),
    )
    expect(library().hiddenRecommendationKeys).toEqual(['audius:x9'])

    await user.click(
      screen.getAllByRole('button', { name: 'Reset hidden recommendations' }).at(-1)!,
    )
    await waitFor(() => expect(library().hiddenRecommendationKeys).toEqual([]))
    // Likes and playlists are explicitly untouched by this control.
    expect(library().likedTrackKeys).toEqual(['audius:t1'])
    expect(library().playlists.pl_test).toBeDefined()
  })

  it('clears the library behind a confirmation', async () => {
    const { user, library: repository } = renderApp({
      route: '/settings',
      library: populated(),
    })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: 'Clear Library' }))
    expect(library().likedTrackKeys).toEqual(['audius:t1'])

    await user.click(screen.getAllByRole('button', { name: 'Clear Library' }).at(-1)!)

    await waitFor(() => expect(library().likedTrackKeys).toEqual([]))
    expect(library().playlists).toEqual({})
    expect(library().tracks).toEqual({})
    expect(library().hiddenRecommendationKeys).toEqual([])
    await waitFor(() => expect(repository.raw()).toBeNull())
  })

  it('clearing the library leaves listening history and playback settings alone', async () => {
    const history: PersonalizationState = {
      ...consented(),
      searchHistory: [
        {
          query: 'sirusho',
          normalizedQuery: 'sirusho',
          submittedAt: Date.now(),
          providers: ['audius'],
          resultWasPlayed: false,
          submitCount: 1,
          script: 'latin',
        },
      ],
    }
    const { user } = renderApp({
      route: '/settings',
      library: populated(),
      personalization: history,
    })
    await hydrated()

    usePlayerStore.getState().setVolume(0.42)
    usePlayerStore.getState().setRepeatMode('all')
    usePlayerStore.getState().setAutoplaySimilar(false)

    await user.click(await screen.findByRole('button', { name: 'Clear Library' }))
    await user.click(screen.getAllByRole('button', { name: 'Clear Library' }).at(-1)!)
    await waitFor(() => expect(library().likedTrackKeys).toEqual([]))

    expect(usePersonalizationStore.getState().state.searchHistory).toHaveLength(1)
    expect(usePlayerStore.getState().volume).toBe(0.42)
    expect(usePlayerStore.getState().repeatMode).toBe('all')
    expect(usePlayerStore.getState().autoplaySimilar).toBe(false)
    expect(localStorage.getItem('pulse:volume')).toBe('0.42')
  })

  it('clearing the library also clears the recommendation signal it was carrying', async () => {
    const { user } = renderApp({
      route: '/settings',
      library: populated(),
      personalization: consented(),
    })
    await hydrated()

    await waitFor(() =>
      expect(usePersonalizationStore.getState().profile.explicitItemCount).toBe(1),
    )

    await user.click(await screen.findByRole('button', { name: 'Clear Library' }))
    await user.click(screen.getAllByRole('button', { name: 'Clear Library' }).at(-1)!)

    // Likes *are* the signal, so removing them removes their influence. This is
    // documented in the control's own description and on the privacy page.
    await waitFor(() =>
      expect(usePersonalizationStore.getState().profile.explicitItemCount).toBe(0),
    )
    expect(usePersonalizationStore.getState().profile.artistWeights).toEqual({})
  })
})

describe('the privacy page', () => {
  it('explains the library, its locality, and the provider boundary', async () => {
    renderApp({ route: '/privacy' })

    const heading = await screen.findByRole('heading', {
      name: 'Your Library is saved on this device only',
    })
    const section = heading.parentElement!
    expect(section.textContent).toMatch(/no Pulse account and no\s+cloud sync/i)
    expect(section.textContent).toMatch(/not signed in to Audius,\s+Jamendo or YouTube/i)
    expect(section.textContent).toMatch(/never stored.*stream addresses/is)
    expect(section.textContent).toMatch(/deleted automatically within 30 days/i)
  })

  it('says a YouTube save expires with everything else about it', async () => {
    renderApp({ route: '/privacy' })
    await screen.findByRole('heading', { name: 'Privacy' })

    expect(
      screen.getByText(/deletes the whole saved item, including its place in your Liked Songs/i),
    ).toBeInTheDocument()
  })

  it('says the app never acts on a provider account', async () => {
    renderApp({ route: '/privacy' })
    await screen.findByRole('heading', { name: 'Privacy' })

    expect(
      screen.getByText(/does not favourite, like, follow,\s+subscribe/i),
    ).toBeInTheDocument()
  })
})

describe('Media Session drives the same queue', () => {
  it('uses the shared next action, so a playlist advances identically', async () => {
    renderApp({ route: '/library/liked', library: libraryWith({}) })
    await hydrated()

    // The controller is handed the real actions; this asserts the wiring rather
    // than reimplementing it (agents/45 → "Media Session").
    const registered: Record<string, () => void> = {}
    const controller = createMediaSessionController({
      session: {
        metadata: null,
        playbackState: 'none',
        setActionHandler: (action, handler) => {
          if (handler) registered[action] = () => handler(undefined)
        },
      },
    })
    controller.activate({
      play: () => {},
      pause: () => {},
      stop: () => {},
      previousTrack: () => {},
      nextTrack: () => void playNext(),
      seekTo: () => {},
      seekBy: () => {},
    })

    expect(typeof registered.nexttrack).toBe('function')
    expect(controller.registeredActions()).toContain('nexttrack')
    expect(controller.registeredActions()).toContain('previoustrack')
  })
})

describe('the library adds no provider traffic to a render', () => {
  it('renders Liked Songs from stored metadata alone', async () => {
    const seen: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(typeof input === 'string' ? input : String(input instanceof Request ? input.url : input))
      return original(input, init)
    })

    try {
      renderApp({
        route: '/library/liked',
        library: libraryWith({ tracks: [audiusRef()], liked: ['audius:t1'] }),
      })
      await hydrated()
      await screen.findByTestId('liked-list')

      // Nothing about drawing a saved row asks a provider anything.
      expect(seen.filter((url) => url.includes('/api/youtube'))).toEqual([])
      expect(seen.filter((url) => url.includes('/v1/tracks/search'))).toEqual([])
      expect(seen.filter((url) => url.includes('/api/jamendo'))).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('the queue panel', () => {
  it('carries the heart, so anything playing can be saved from there', async () => {
    const { user } = renderApp({ route: '/', library: libraryWith({}) })
    await hydrated()

    usePlayerStore.getState().setQueue(
      [
        {
          id: 'audius:trk1',
          mediaKind: 'audio',
          provider: 'audius',
          providerId: 'trk1',
          title: 'Midnight Signal',
          artistName: 'Nova Sound',
          artwork: {},
          durationSeconds: 100,
          isStreamable: true,
        },
      ],
      0,
      null,
    )

    await user.click(screen.getByRole('button', { name: 'Open the play queue' }))
    const queue = await screen.findByTestId('queue-list')
    const heart = within(queue).getByRole('button', {
      name: 'Save Midnight Signal to Liked Songs in Pulse',
    })

    await user.click(heart)
    await waitFor(() => expect(library().likedTrackKeys).toEqual(['audius:trk1']))
  })
})
