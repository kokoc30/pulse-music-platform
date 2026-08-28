import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { AUDIUS_BASE } from '@/test/msw/handlers'
import { catalogSearchResponse } from '@/test/fixtures/audius'
import { server } from '@/test/msw/server'
import { renderApp } from '@/test/render'
import { makeEntry, makeSearch, makeState } from '@/test/fixtures/personalization'
import { RECENT_SEARCH_SUGGESTIONS } from '@/personalization/config'
import { usePersonalizationStore } from '@/personalization/store'
import { usePlayerStore } from '@/player/player-store'
import { useYouTubeStore } from '@/player/youtube-store'
import type { PersonalizationState } from '@/personalization/types'

/**
 * The search history dropdown.
 *
 * The through-line of these tests is that the dropdown is a *view of history
 * plus one submit path* — it must never become a second search implementation,
 * a second history store, or a source of network traffic.
 */

/** History a returning visitor would already have. */
function seeded(overrides: Partial<PersonalizationState> = {}): PersonalizationState {
  return makeState({
    searchHistory: [
      makeSearch({ query: 'Adele Hello', daysAgo: 0 }),
      makeSearch({ query: 'aram asatryan', daysAgo: 1 }),
      makeSearch({ query: 'sara al sawas', daysAgo: 2 }),
      makeSearch({ query: 'Кино Группа крови', script: 'cyrillic', daysAgo: 3 }),
    ],
    ...overrides,
  })
}

/** The fixtures are anchored to a fixed date; YouTube retention reads the clock. */
const CLOCK = Date.parse('2026-06-15T12:00:00Z')

beforeEach(() => vi.useFakeTimers({ now: CLOCK, shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

const field = () => screen.getByLabelText('Search songs and artists')
const dropdown = () => screen.queryByTestId('search-suggestions')
/** Scoped queries: the home page shows a Recently Played shelf with the same text. */
const inDropdown = () => within(screen.getByTestId('search-suggestions'))
const optionNames = () => screen.getAllByRole('option').map((n) => n.getAttribute('aria-label') ?? '')
const searchRowTexts = () =>
  [...document.querySelectorAll('.suggestion-row:not(.suggestion-row-media) .suggestion-text')].map(
    (n) => n.textContent ?? '',
  )

/** Counts every Audius catalogue search the page performs. */
function countAudiusSearches() {
  const queries: string[] = []
  server.use(
    http.get(`${AUDIUS_BASE}/v1/search/full`, ({ request }) => {
      queries.push(new URL(request.url).searchParams.get('query') ?? '')
      return HttpResponse.json(catalogSearchResponse())
    }),
  )
  return queries
}

describe('opening the dropdown', () => {
  it('opens on focus when history exists', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })

    expect(dropdown()).toBeNull()
    await user.click(field())
    expect(await screen.findByTestId('search-suggestions')).toBeInTheDocument()
  })

  it('opens on keyboard focus, not only on a click', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByTestId('search-suggestions')).toBeInTheDocument()
  })

  it('stays closed when there is no history to show', async () => {
    const { user } = renderApp({ personalization: makeState() })
    await screen.findByRole('heading', { name: 'Trending songs' })

    await user.click(field())
    expect(dropdown()).toBeNull()
    // …and the field still works.
    expect(field()).toBeEnabled()
  })

  it('reports its state through aria-expanded', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })

    expect(field()).toHaveAttribute('aria-expanded', 'false')
    await user.click(field())
    await waitFor(() => expect(field()).toHaveAttribute('aria-expanded', 'true'))
    expect(field()).toHaveAttribute('aria-controls', 'search-suggestions')
  })
})

describe('recent searches', () => {
  it('lists the most recent first', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    expect(searchRowTexts()).toEqual([
      'Adele Hello',
      'aram asatryan',
      'sara al sawas',
      'Кино Группа крови',
    ])
  })

  it('shows no more than the display cap, however much is stored', async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      makeSearch({ query: `query ${index}`, daysAgo: index }),
    )
    const { user } = renderApp({ personalization: makeState({ searchHistory: many }) })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    expect(searchRowTexts()).toHaveLength(RECENT_SEARCH_SUGGESTIONS)
  })

  describe('non-Latin queries render byte-exact', () => {
    const cases = ['سارة السواس', 'Արամ Ասատրյան', 'Кино Группа крови', 'Сирушо']

    for (const query of cases) {
      it(`renders ${query} exactly as typed`, async () => {
        const { user } = renderApp({
          personalization: makeState({ searchHistory: [makeSearch({ query })] }),
        })
        await screen.findByRole('heading', { name: 'Trending songs' })
        await user.click(field())

        expect(searchRowTexts()).toEqual([query])
      })
    }
  })

  it('shows one row per deduplicated query, not one per submission', async () => {
    // The history model already dedupes on the normalized form; the dropdown
    // must not undo that by rendering the raw list.
    const { user } = renderApp({ personalization: makeState() })
    await screen.findByRole('heading', { name: 'Trending songs' })

    const store = usePersonalizationStore.getState()
    store.setConsent('granted')
    store.recordSearch({ query: 'Adele Hello' })
    store.recordSearch({ query: 'ADELE HELLO' })
    store.recordSearch({ query: 'Adele   Hello' })

    await user.click(field())
    expect(searchRowTexts()).toEqual(['Adele Hello'])
  })
})

describe('choosing a recent search', () => {
  it('runs the search through the normal route', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(screen.getByRole('option', { name: 'Search again for aram asatryan' }))

    expect(await screen.findByRole('heading', { name: /Results for “aram asatryan”/ })).toBeInTheDocument()
    expect(field()).toHaveValue('aram asatryan')
  })

  it('closes the dropdown on selection', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(screen.getByRole('option', { name: 'Search again for aram asatryan' }))
    await waitFor(() => expect(dropdown()).toBeNull())
  })

  it('counts as another explicit submission, moving the query back to the top', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(screen.getByRole('option', { name: 'Search again for sara al sawas' }))
    await screen.findByRole('heading', { name: /Results for/ })

    await waitFor(() =>
      expect(usePersonalizationStore.getState().state.searchHistory[0].query).toBe('sara al sawas'),
    )
    // Reused, not duplicated.
    expect(usePersonalizationStore.getState().state.searchHistory).toHaveLength(4)

    await user.click(field())
    expect(searchRowTexts()[0]).toBe('sara al sawas')
  })

  it('preserves a non-Latin query through the whole round trip', async () => {
    const { user } = renderApp({
      personalization: makeState({ searchHistory: [makeSearch({ query: 'سارة السواس' })] }),
    })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(screen.getByRole('option', { name: 'Search again for سارة السواس' }))
    expect(await screen.findByRole('heading', { name: /سارة السواس/ })).toBeInTheDocument()
  })
})

describe('typing filters local history only', () => {
  it('narrows the list as the visitor types', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())
    await user.type(field(), 'ara')

    // Both `aram asatryan` and `sara al sawas` contain "ara".
    expect(searchRowTexts()).toEqual(['aram asatryan', 'sara al sawas'])
  })

  it('hides recently played once the visitor is narrowing a query', async () => {
    const { user } = renderApp({
      personalization: seeded({ listeningHistory: [makeEntry({ id: 'a', daysAgo: 0 })] }),
    })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())
    expect(inDropdown().getByText('Recently played')).toBeInTheDocument()

    await user.type(field(), 'ara')
    expect(inDropdown().queryByText('Recently played')).toBeNull()
  })

  it('closes the dropdown when nothing matches rather than showing an empty panel', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())
    await user.type(field(), 'zzzzz')

    expect(dropdown()).toBeNull()
  })

  it('keeps a Cyrillic query reachable only through Cyrillic input', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.type(field(), 'Кино')
    expect(searchRowTexts()).toEqual(['Кино Группа крови'])
  })

  it('makes no provider request to produce suggestions', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const queries = countAudiusSearches()
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })

    await user.click(field())
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    // Opening, arrowing and highlighting: still nothing typed, still no search.
    expect(queries).toHaveLength(0)

    // Filtering is in-memory; the only request that ever follows is the existing
    // debounced search-as-you-type, which is unchanged behaviour.
    await user.type(field(), 'ara')
    expect(queries).toHaveLength(0)
    vi.useRealTimers()
  })
})

describe('removing one recent search', () => {
  it('removes just that row', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(
      screen.getByRole('button', { name: 'Remove “aram asatryan” from recent searches' }),
    )

    await waitFor(() => expect(searchRowTexts()).not.toContain('aram asatryan'))
    expect(searchRowTexts()).toEqual(['Adele Hello', 'sara al sawas', 'Кино Группа крови'])
  })

  it('does not run the search it removed', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(
      screen.getByRole('button', { name: 'Remove “aram asatryan” from recent searches' }),
    )

    expect(screen.queryByRole('heading', { name: /Results for/ })).toBeNull()
    expect(field()).toHaveValue('')
  })

  it('leaves the dropdown open so more can be removed', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(
      screen.getByRole('button', { name: 'Remove “aram asatryan” from recent searches' }),
    )
    expect(dropdown()).toBeInTheDocument()
  })

  it('persists the removal', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(
      screen.getByRole('button', { name: 'Remove “aram asatryan” from recent searches' }),
    )

    await waitFor(() =>
      expect(
        usePersonalizationStore
          .getState()
          .state.searchHistory.map((entry) => entry.query),
      ).not.toContain('aram asatryan'),
    )
    const raw = JSON.parse(localStorage.getItem('pulse.personalization.v1') ?? '{}') as {
      searchHistory: Array<{ query: string }>
    }
    expect(raw.searchHistory.map((entry) => entry.query)).not.toContain('aram asatryan')
  })

  it('never touches listening history', async () => {
    const { user } = renderApp({
      personalization: seeded({ listeningHistory: [makeEntry({ id: 'a', daysAgo: 0 })] }),
    })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(
      screen.getByRole('button', { name: 'Remove “aram asatryan” from recent searches' }),
    )

    expect(usePersonalizationStore.getState().state.listeningHistory).toHaveLength(1)
  })
})

describe('clearing recent searches', () => {
  it('removes every search through the existing Settings behaviour', async () => {
    const { user } = renderApp({
      personalization: seeded({ listeningHistory: [makeEntry({ id: 'a', daysAgo: 0 })] }),
    })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() =>
      expect(usePersonalizationStore.getState().state.searchHistory).toEqual([]),
    )
  })

  it('keeps listening history, recently played and consent intact', async () => {
    const { user } = renderApp({
      personalization: seeded({ listeningHistory: [makeEntry({ id: 'a', daysAgo: 0 })] }),
    })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    const state = usePersonalizationStore.getState().state
    expect(state.listeningHistory).toHaveLength(1)
    expect(state.consent).toBe('granted')
    // Recently played survives, so the dropdown still has something to show.
    await waitFor(() => expect(inDropdown().getByText('Recently played')).toBeInTheDocument())
  })

  it('leaves the player volume alone', async () => {
    localStorage.setItem('pulse:volume', '0.42')
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(localStorage.getItem('pulse:volume')).toBe('0.42')
  })
})

describe('keyboard navigation', () => {
  it('moves down and up through the rows', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.keyboard('{ArrowDown}')
    expect(field()).toHaveAttribute('aria-activedescendant', 'search-suggestion-0')
    await user.keyboard('{ArrowDown}')
    expect(field()).toHaveAttribute('aria-activedescendant', 'search-suggestion-1')
    await user.keyboard('{ArrowUp}')
    expect(field()).toHaveAttribute('aria-activedescendant', 'search-suggestion-0')
  })

  it('wraps around at both ends', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.keyboard('{ArrowUp}')
    expect(field()).toHaveAttribute('aria-activedescendant', 'search-suggestion-3')
    await user.keyboard('{ArrowDown}')
    expect(field()).toHaveAttribute('aria-activedescendant', 'search-suggestion-0')
  })

  it('does not change the typed text while arrowing', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())
    await user.type(field(), 'ara')

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(field()).toHaveValue('ara')
  })

  it('activates the highlighted row on Enter', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(await screen.findByRole('heading', { name: /Results for “aram asatryan”/ })).toBeInTheDocument()
  })

  it('submits the typed query when no row is highlighted', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())
    await user.type(field(), 'midnight{Enter}')

    expect(await screen.findByRole('heading', { name: /Results for “midnight”/ })).toBeInTheDocument()
  })

  it('closes on Escape and keeps focus and the typed text', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())
    await user.type(field(), 'ara')

    await user.keyboard('{Escape}')
    expect(dropdown()).toBeNull()
    expect(field()).toHaveFocus()
    expect(field()).toHaveValue('ara')
  })

  it('does not trap focus: Tab leaves the field', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.tab()
    expect(field()).not.toHaveFocus()
  })

  it('removes the highlighted row on Delete when the field is empty', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.keyboard('{ArrowDown}{ArrowDown}')
    await user.keyboard('{Delete}')

    await waitFor(() => expect(searchRowTexts()).not.toContain('aram asatryan'))
    expect(screen.queryByRole('heading', { name: /Results for/ })).toBeNull()
  })
})

describe('closing the dropdown', () => {
  it('closes on a click outside', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())
    expect(dropdown()).toBeInTheDocument()

    await user.click(screen.getByRole('heading', { name: 'Trending songs' }))
    await waitFor(() => expect(dropdown()).toBeNull())
  })

  it('closes when navigating away', async () => {
    const { user } = renderApp({ personalization: seeded() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(screen.getByRole('link', { name: 'Pulse home' }))
    await waitFor(() => expect(dropdown()).toBeNull())
  })
})

describe('recently played inside the dropdown', () => {
  const withHistory = () =>
    seeded({
      listeningHistory: [
        makeEntry({ id: 'trk1', title: 'Midnight Signal', artist: 'Nova Sound', daysAgo: 0 }),
        makeEntry({
          id: 'aaaaaaaaaaa',
          provider: 'youtube',
          title: 'Night Signal',
          artist: 'Aster Vale',
          daysAgo: 1,
        }),
      ],
    })

  it('appears beneath the searches when listening history exists', async () => {
    const { user } = renderApp({ personalization: withHistory() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    expect(inDropdown().getByText('Recently played')).toBeInTheDocument()
    expect(optionNames()).toContain('Play Midnight Signal by Nova Sound from Audius')
  })

  it('orders most recently played first, from the shared selector', async () => {
    const { user } = renderApp({ personalization: withHistory() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    const media = optionNames().filter((name) => name.startsWith('Play '))
    expect(media[0]).toContain('Midnight Signal')
    expect(media[1]).toContain('Night Signal')
  })

  it('replays a catalogue track through the audio engine', async () => {
    const { user, engine } = renderApp({ personalization: withHistory() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(
      screen.getByRole('option', { name: 'Play Midnight Signal by Nova Sound from Audius' }),
    )

    await waitFor(() => expect(engine.playing).toBe(true))
    expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal')
  })

  it('replays a YouTube entry through the embedded player, never the audio element', async () => {
    const { user, engine } = renderApp({ personalization: withHistory() })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    await user.click(
      screen.getByRole('option', { name: 'Play Night Signal by Aster Vale from YouTube' }),
    )

    await waitFor(() => expect(useYouTubeStore.getState().item?.videoId).toBe('aaaaaaaaaaa'))
    expect(engine.playing).toBe(false)
    expect(usePlayerStore.getState().currentTrack).toBeNull()
  })

  it('omits an expired YouTube entry', async () => {
    const { user } = renderApp({
      personalization: seeded({
        listeningHistory: [
          makeEntry({ id: 'gone', provider: 'youtube', title: 'Old Video', daysAgo: 1, storedDaysAgo: 45 }),
          makeEntry({ id: 'trk1', title: 'Midnight Signal', daysAgo: 2 }),
        ],
      }),
    })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    expect(inDropdown().queryByText('Old Video')).toBeNull()
    expect(inDropdown().getByText('Midnight Signal')).toBeInTheDocument()
  })

  it('omits a made-for-kids or non-embeddable YouTube entry', async () => {
    const { user } = renderApp({
      personalization: seeded({
        listeningHistory: [
          makeEntry({ id: 'kids', provider: 'youtube', title: 'Kids Video', madeForKids: true, daysAgo: 0 }),
          makeEntry({ id: 'blocked', provider: 'youtube', title: 'Blocked Video', embeddable: false, daysAgo: 1 }),
          makeEntry({ id: 'trk1', title: 'Midnight Signal', daysAgo: 2 }),
        ],
      }),
    })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())

    expect(inDropdown().queryByText('Kids Video')).toBeNull()
    expect(inDropdown().queryByText('Blocked Video')).toBeNull()
    expect(inDropdown().getByText('Midnight Signal')).toBeInTheDocument()
  })

  it('reorders live when a track is replayed, with no reload', async () => {
    // The dropdown and the home shelf read one canonical ordering, so a replay
    // must reorder both.
    const { user } = renderApp({
      personalization: seeded({
        listeningHistory: [
          makeEntry({ id: 'skrillex', title: 'RATATA', artist: 'Skrillex', daysAgo: 0 }),
          makeEntry({ id: 'miyagi', title: 'Kosandra', artist: 'Miyagi', daysAgo: 2 }),
        ],
      }),
    })
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(field())
    expect(optionNames().filter((n) => n.startsWith('Play '))[0]).toContain('RATATA')

    usePersonalizationStore.getState().noteReplayStarted({
      provider: 'audius',
      providerItemId: 'miyagi',
      title: 'Kosandra',
      artist: 'Miyagi',
      context: 'recent',
    })

    await waitFor(() =>
      expect(optionNames().filter((n) => n.startsWith('Play '))[0]).toContain('Kosandra'),
    )
  })
})

describe('consent', () => {
  it('shows nothing when personalization was declined', async () => {
    const { user } = renderApp({
      personalization: makeState({
        consent: 'denied',
        searchHistory: [makeSearch({ query: 'aram asatryan' })],
      }),
    })
    await screen.findByRole('heading', { name: 'Trending songs' })

    await user.click(field())
    expect(dropdown()).toBeNull()
  })

  it('shows nothing when personalization has not been answered', async () => {
    const { user } = renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })

    await user.click(field())
    expect(dropdown()).toBeNull()
  })

  it('search still works in every consent state', async () => {
    const { user } = renderApp({ personalization: makeState({ consent: 'denied' }) })
    await screen.findByRole('heading', { name: 'Trending songs' })

    await user.type(field(), 'midnight{Enter}')
    expect(await screen.findByRole('heading', { name: /Results for “midnight”/ })).toBeInTheDocument()
  })
})
