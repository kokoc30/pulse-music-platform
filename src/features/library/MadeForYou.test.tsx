import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { audiusRef, libraryWith, trackPool } from '@/test/fixtures/library'
import { useLibraryStore } from '@/library/store'
import { usePersonalizationStore } from '@/personalization/store'
import { createEmptyState } from '@/personalization/types'
import type { PersonalizationState } from '@/personalization/types'
import { usePlayerStore } from '@/player/player-store'
import { rememberTracks } from '@/player/autoplay'

/**
 * Made-for-you mixes on the home page.
 *
 * The candidate pool is seeded through `rememberTracks` — the Phase 6 session
 * pool, which is exactly where a real mix's candidates come from: tracks the
 * session has already loaded. Seeding it directly keeps these tests about mixes
 * rather than about how quickly the discovery shelves happen to resolve.
 */

const consented = (): PersonalizationState => ({
  ...createEmptyState(Date.now()),
  consent: 'granted',
  preferences: { promptSeen: true },
})

const savedLibrary = (count = 3) =>
  libraryWith({
    tracks: Array.from({ length: count }, (_, index) =>
      audiusRef({
        key: `audius:p${index}`,
        providerItemId: `p${index}`,
        title: `Pool Track ${index}`,
        artist: `Pool Artist ${index}`,
      }),
    ),
    liked: Array.from({ length: count }, (_, index) => `audius:p${index}`),
  })

async function hydrated() {
  await waitFor(() => expect(useLibraryStore.getState().hydrated).toBe(true))
}

async function mixesRendered() {
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Made for you' })).toBeInTheDocument(),
  )
}

const mixCards = () => [...document.querySelectorAll<HTMLElement>('.mix-card')]

describe('cold start is honest', () => {
  it('shows no Made for you section to a brand-new browser', async () => {
    renderApp({ route: '/' })
    rememberTracks(trackPool(40, { artists: 40, genre: 'House' }))
    await hydrated()

    await screen.findByRole('heading', { name: 'Trending songs' })
    expect(screen.queryByRole('heading', { name: 'Made for you' })).toBeNull()
  })

  it('shows none with one or two saves — that is not a taste', async () => {
    renderApp({ route: '/', library: savedLibrary(2), personalization: consented() })
    rememberTracks(trackPool(40, { artists: 40, genre: 'House' }))
    await hydrated()

    await screen.findByRole('heading', { name: 'Trending songs' })
    expect(screen.queryByRole('heading', { name: 'Made for you' })).toBeNull()
  })

  it('shows none with personalization refused, however much is saved', async () => {
    renderApp({
      route: '/',
      library: savedLibrary(8),
      personalization: { ...createEmptyState(Date.now()), consent: 'denied' },
    })
    rememberTracks(trackPool(40, { artists: 40, genre: 'House' }))
    await hydrated()

    await screen.findByRole('heading', { name: 'Trending songs' })
    expect(screen.queryByRole('heading', { name: 'Made for you' })).toBeNull()
    // The library itself is untouched by that refusal.
    expect(useLibraryStore.getState().state.likedTrackKeys).toHaveLength(8)
  })

  it('shows none when the pool cannot fill a real mix', async () => {
    renderApp({ route: '/', library: savedLibrary(), personalization: consented() })
    rememberTracks(trackPool(6, { artists: 6 }))
    await hydrated()

    await screen.findByRole('heading', { name: 'Trending songs' })
    expect(screen.queryByRole('heading', { name: 'Made for you' })).toBeNull()
  })
})

describe('with real evidence', () => {
  const seeded = () => {
    const result = renderApp({
      route: '/',
      library: savedLibrary(),
      personalization: consented(),
    })
    rememberTracks(trackPool(40, { artists: 40, genre: 'House' }))
    return result
  }

  it('shows the section, with an honest description', async () => {
    seeded()
    await hydrated()
    await mixesRendered()

    expect(
      screen.getByText(/Built on this device from what you play and save\. Nothing is uploaded\./),
    ).toBeInTheDocument()
  })

  it('keeps the page to its five shelves', async () => {
    seeded()
    await hydrated()
    await mixesRendered()

    expect(document.querySelectorAll('.browse-content > .music-section').length).toBe(5)
  })

  it('offers one to three mixes, each with a real number of songs', async () => {
    seeded()
    await hydrated()
    await mixesRendered()

    const cards = mixCards()
    expect(cards.length).toBeGreaterThanOrEqual(1)
    expect(cards.length).toBeLessThanOrEqual(3)

    for (const card of cards) {
      const label = within(card).getByText(/\d+ songs ·/)
      const count = Number(/(\d+) songs/.exec(label.textContent ?? '')![1])
      expect(count).toBeGreaterThanOrEqual(15)
      expect(count).toBeLessThanOrEqual(30)
    }
  })

  it('never claims anything about who the listener is', async () => {
    seeded()
    await hydrated()
    await mixesRendered()

    const section = document.querySelector('#made-for-you')!
    const text = section.textContent.toLowerCase()
    for (const forbidden of ['nationality', 'ethnic', 'religio', 'because you are']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('plays a mix through the ordinary queue', async () => {
    const { user } = seeded()
    await hydrated()
    await mixesRendered()

    await user.click(mixCards()[0].querySelector<HTMLElement>('.card-play')!)

    await waitFor(() => expect(usePlayerStore.getState().currentTrack).not.toBeNull())
    expect(usePlayerStore.getState().queue.length).toBeGreaterThanOrEqual(15)
    expect(usePlayerStore.getState().queueContext?.id).toMatch(/^mix:/)
  })

  it('excludes what the visitor has already saved', async () => {
    seeded()
    await hydrated()
    await mixesRendered()

    for (const card of mixCards()) {
      // The first three pool tracks are the liked ones.
      expect(card.textContent).not.toContain('Pool Track 0')
    }
  })
})

describe('Save as playlist', () => {
  const seeded = () => {
    const result = renderApp({
      route: '/',
      library: savedLibrary(),
      personalization: consented(),
    })
    rememberTracks(trackPool(40, { artists: 40, genre: 'House' }))
    return result
  }

  const openSave = async (user: ReturnType<typeof renderApp>['user']) => {
    const card = mixCards()[0]
    const title = within(card).getByRole('heading', { level: 3 }).textContent
    await user.click(
      within(card).getByRole('button', { name: `Save ${title} as a playlist in Pulse` }),
    )
    return { card, title }
  }

  it('snapshots the current order into an ordinary local playlist', async () => {
    const { user } = seeded()
    await hydrated()
    await mixesRendered()

    const { card } = await openSave(user)
    const field = within(card).getByLabelText('Playlist name')
    await user.clear(field)
    await user.type(field, 'My Snapshot')
    await user.click(within(card).getByRole('button', { name: 'Save as playlist' }))

    await waitFor(() => {
      const saved = Object.values(useLibraryStore.getState().state.playlists).find(
        (list) => list.name === 'My Snapshot',
      )
      expect(saved).toBeDefined()
      expect(saved!.itemKeys.length).toBeGreaterThanOrEqual(15)
    })
  })

  it('names it after the mix and the day, so repeats stay distinguishable', async () => {
    const { user } = seeded()
    await hydrated()
    await mixesRendered()

    const { card, title } = await openSave(user)
    expect(within(card).getByLabelText<HTMLInputElement>('Playlist name').value).toContain(title)
  })

  it('produces something that no longer changes when the evidence does', async () => {
    const { user } = seeded()
    await hydrated()
    await mixesRendered()

    const { card } = await openSave(user)
    await user.click(within(card).getByRole('button', { name: 'Save as playlist' }))

    const saved = await waitFor(() => {
      const list = Object.values(useLibraryStore.getState().state.playlists)[0]
      expect(list).toBeDefined()
      return list
    })
    const snapshot = [...saved.itemKeys]
    expect(snapshot.length).toBeGreaterThanOrEqual(15)

    // The inputs move underneath it. A virtual mix would be rebuilt; a saved
    // playlist is an independent object and is not.
    usePersonalizationStore.getState().dismissItem(snapshot[0])
    useLibraryStore.getState().hide(snapshot[1])
    useLibraryStore.getState().like(
      audiusRef({ key: 'audius:p20', providerItemId: 'p20', title: 'Pool Track 20' }),
    )

    await waitFor(() =>
      expect(useLibraryStore.getState().state.playlists[saved.id].itemKeys).toEqual(snapshot),
    )
  })

  it('is reachable from Your Library afterwards, like any other playlist', async () => {
    const { user } = seeded()
    await hydrated()
    await mixesRendered()

    const { card } = await openSave(user)
    const field = within(card).getByLabelText('Playlist name')
    await user.clear(field)
    await user.type(field, 'Saved Mix')
    await user.click(within(card).getByRole('button', { name: 'Save as playlist' }))

    await waitFor(() => {
      const sidebar = [...document.querySelectorAll('.sidebar-library-row')]
      expect(sidebar.some((row) => row.textContent?.includes('Saved Mix'))).toBe(true)
    })
  })
})

describe('hiding a recommendation reaches the mixes', () => {
  it('removes the item from every generated section', async () => {
    renderApp({ route: '/', library: savedLibrary(), personalization: consented() })
    rememberTracks(trackPool(40, { artists: 40, genre: 'House' }))
    await hydrated()
    await mixesRendered()

    const { markNotInterested } = await import('@/library/library-actions')
    markNotInterested('audius:p10')

    await waitFor(() =>
      expect(useLibraryStore.getState().state.hiddenRecommendationKeys).toContain('audius:p10'),
    )
    await waitFor(() => {
      for (const card of mixCards()) expect(card.textContent).not.toContain('Pool Track 10')
    })
  })
})

describe('a mix costs no provider request', () => {
  it('makes no YouTube request, and no extra catalogue search, to render one', async () => {
    const seen: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(typeof input === 'string' ? input : String(input instanceof Request ? input.url : input))
      return original(input, init)
    })

    try {
      renderApp({ route: '/', library: savedLibrary(), personalization: consented() })
      rememberTracks(trackPool(40, { artists: 40, genre: 'House' }))
      await hydrated()
      await mixesRendered()

      expect(seen.filter((url) => url.includes('/api/youtube'))).toEqual([])
      expect(seen.filter((url) => url.includes('/v1/tracks/search'))).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  })
})
