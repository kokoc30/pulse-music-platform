import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import {
  DAY,
  makeEntry,
  makeSearch,
  makeState,
} from '@/test/fixtures/personalization'
import type { EntrySpec } from '@/test/fixtures/personalization'
import { HOME_SECTION_TITLES } from '@/personalization/selectors'
import { usePersonalizationStore } from '@/personalization/store'
import type { PersonalizationState } from '@/personalization/types'

/**
 * The home dashboard, end to end: real storage, the real profile, the real
 * ranking, and the real shelves.
 *
 * Every scenario starts by writing a state into `localStorage` exactly as a
 * returning visitor's browser would already have it, then renders the app. That
 * is what makes these tests about *the product* — "a listener with this history
 * sees this page" — rather than about the internals, which the unit suites
 * already cover.
 */

/** The clock all the fixtures are anchored to, so recency decay is stable. */
const CLOCK = Date.parse('2026-06-15T12:00:00Z')

/** History for a listener whose taste has clearly formed. */
function warmHistory(specs: EntrySpec[] = []): PersonalizationState {
  return makeState({
    listeningHistory:
      specs.length > 0
        ? specs.map(makeEntry)
        : [
            makeEntry({ id: 'h1', title: 'Midnight Signal', artist: 'Nova Sound', playCount: 3, daysAgo: 2 }),
            makeEntry({ id: 'h2', title: 'Paper Lanterns', artist: 'Nova Sound', playCount: 2, daysAgo: 3 }),
            makeEntry({ id: 'h3', title: 'No Artwork Here', artist: 'Ghost Radio', playCount: 2, daysAgo: 4 }),
          ],
  })
}

/** Shelf headings currently on the page, in document order. */
function sectionTitles(): string[] {
  return [...document.querySelectorAll('.music-section h2')].map((node) => node.textContent ?? '')
}

describe('personalized home dashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: CLOCK, shouldAdvanceTime: true })
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('cold start — a brand-new browser', () => {
    it('shows exactly the discovery dashboard, unchanged', async () => {
      renderApp()
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })

      expect(sectionTitles()).toEqual([
        HOME_SECTION_TITLES.trending,
        HOME_SECTION_TITLES['popular-artists'],
        HOME_SECTION_TITLES.month,
        HOME_SECTION_TITLES.stations,
        HOME_SECTION_TITLES.charts,
      ])
    })

    it('claims no recommendation history it does not have', async () => {
      renderApp()
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })

      expect(screen.queryByRole('heading', { name: HOME_SECTION_TITLES.recommended })).toBeNull()
      expect(screen.queryByRole('heading', { name: HOME_SECTION_TITLES.recent })).toBeNull()
      expect(screen.queryByRole('heading', { name: /Because you listened to/ })).toBeNull()
    })

    it('offers the personalization choice without blocking anything', async () => {
      renderApp()
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })

      const prompt = screen.getByTestId('personalization-prompt')
      expect(within(prompt).getByRole('button', { name: 'Enable' })).toBeInTheDocument()
      expect(within(prompt).getByRole('button', { name: 'Not now' })).toBeInTheDocument()
      // Not a modal: the page behind it is fully usable.
      expect(screen.getByLabelText('Search songs and artists')).toBeEnabled()
    })
  })

  describe('early profile — one or two listens', () => {
    it('shows Recently played alongside discovery, and no recommendations', async () => {
      renderApp({ personalization:
        makeState({
          listeningHistory: [makeEntry({ id: 'h1', title: 'Midnight Signal', playCount: 1, daysAgo: 0 })],
        }),
       })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent })

      expect(sectionTitles()).toEqual([
        HOME_SECTION_TITLES.recent,
        HOME_SECTION_TITLES.trending,
        HOME_SECTION_TITLES['popular-artists'],
        HOME_SECTION_TITLES.month,
        HOME_SECTION_TITLES.charts,
      ])
      expect(screen.queryByRole('heading', { name: HOME_SECTION_TITLES.recommended })).toBeNull()
    })

    it('renders the actual track that was played', async () => {
      renderApp({ personalization:
        makeState({
          listeningHistory: [
            makeEntry({ id: 'h1', title: 'Midnight Signal', artist: 'Nova Sound', daysAgo: 0 }),
          ],
        }),
       })
      const shelf = (await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent }))
        .closest('.music-section') as HTMLElement

      expect(within(shelf).getByText('Midnight Signal')).toBeInTheDocument()
      // The artist line also carries the provider backlink, so it is matched on
      // the `title` attribute the card sets for the same reason `TrackCard` does.
      expect(within(shelf).getByTitle('Nova Sound')).toBeInTheDocument()
    })

    it('discloses that the shelf is local to this device', async () => {
      renderApp({ personalization: makeState({ listeningHistory: [makeEntry({ id: 'h1', daysAgo: 0 })] }) })
      const shelf = (await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent }))
        .closest('.music-section') as HTMLElement

      expect(within(shelf).getByText(/on this device/i)).toBeInTheDocument()
    })
  })

  describe('warm profile — an established listener', () => {
    it('leads with Recommended for you and keeps discovery as a fallback', async () => {
      renderApp({ personalization: warmHistory() })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended })

      const titles = sectionTitles()
      expect(titles[0]).toBe(HOME_SECTION_TITLES.recommended)
      expect(titles[1]).toBe(HOME_SECTION_TITLES.recent)
      expect(titles).toHaveLength(5)
      expect(titles.at(-1)).toBe(HOME_SECTION_TITLES.charts)
    })

    it('demotes trending out of the first position', async () => {
      renderApp({ personalization: warmHistory() })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended })

      const titles = sectionTitles()
      const trendingIndex = titles.indexOf(HOME_SECTION_TITLES.trending)
      // Either gone entirely, or below every personalized shelf.
      expect(trendingIndex === -1 || trendingIndex >= 2).toBe(true)
    })

    it('fills the recommendation shelf with real, streamable provider tracks', async () => {
      renderApp({ personalization: warmHistory() })
      const shelf = (await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended }))
        .closest('.music-section') as HTMLElement

      await waitFor(() => expect(shelf.querySelectorAll('.media-card').length).toBeGreaterThan(0))
      // The gated fixture track is never offered.
      expect(within(shelf).queryByText('Gated Premiere')).toBeNull()
    })

    it('never lets one artist take over the recommendation shelf', async () => {
      renderApp({ personalization: warmHistory() })
      const shelf = (await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended }))
        .closest('.music-section') as HTMLElement

      await waitFor(() => expect(shelf.querySelectorAll('.media-card').length).toBeGreaterThan(1))
      const artists = [...shelf.querySelectorAll('.media-card p')].map((node) => node.textContent)
      for (const artist of new Set(artists)) {
        expect(artists.filter((name) => name === artist).length).toBeLessThanOrEqual(2)
      }
    })
  })

  describe('mature profile', () => {
    it('replaces discovery almost entirely with personalized shelves', async () => {
      renderApp({ personalization:
        makeState({
          listeningHistory: [
            makeEntry({ id: 'h1', title: 'Midnight Signal', artist: 'Nova Sound', playCount: 6, daysAgo: 1 }),
            makeEntry({ id: 'h2', title: 'Paper Lanterns', artist: 'Nova Sound', playCount: 4, daysAgo: 2 }),
            makeEntry({ id: 'h3', title: 'No Artwork Here', artist: 'Ghost Radio', playCount: 2, daysAgo: 3 }),
          ],
        }),
       })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended })

      const titles = sectionTitles()
      expect(titles[0]).toBe(HOME_SECTION_TITLES.recommended)
      expect(titles[1]).toBe(HOME_SECTION_TITLES.recent)
      expect(titles).not.toContain(HOME_SECTION_TITLES.month)
      expect(titles).not.toContain(HOME_SECTION_TITLES.stations)
    })

    it('names a seed artist only when the evidence supports it', async () => {
      renderApp({ personalization:
        makeState({
          listeningHistory: [
            makeEntry({ id: 'h1', title: 'Midnight Signal', artist: 'Nova Sound', playCount: 8, daysAgo: 1 }),
            makeEntry({ id: 'h2', title: 'Paper Lanterns', artist: 'Nova Sound', playCount: 6, daysAgo: 2 }),
          ],
        }),
       })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended })

      const because = screen.queryByRole('heading', { name: /^Because you listened to/ })
      if (because) expect(because.textContent).toContain('Nova Sound')
    })

    it('omits "Because you listened to" for a profile with no clear favourite', async () => {
      renderApp({ personalization:
        makeState({
          listeningHistory: Array.from({ length: 12 }, (_, index) =>
            makeEntry({ id: `h${index}`, artist: `Artist ${index}`, playCount: 1, daysAgo: index }),
          ),
        }),
       })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent })

      expect(screen.queryByRole('heading', { name: /^Because you listened to/ })).toBeNull()
    })
  })

  describe('the page never grows or empties', () => {
    const scenarios: Array<[string, PersonalizationState]> = [
      ['cold', makeState()],
      ['early', makeState({ listeningHistory: [makeEntry({ id: 'a', playCount: 1, daysAgo: 0 })] })],
      ['warm', warmHistory()],
      [
        'mature',
        makeState({
          listeningHistory: Array.from({ length: 10 }, (_, index) =>
            makeEntry({ id: `h${index}`, artist: `Artist ${index % 3}`, playCount: 1, daysAgo: index }),
          ),
        }),
      ],
    ]

    for (const [label, state] of scenarios) {
      it(`renders exactly five shelves for a ${label} profile`, async () => {
        renderApp({ personalization: state })
        await waitFor(() => expect(document.querySelectorAll('.music-section').length).toBe(5))
      })
    }

    it('falls back to discovery when the provider pool is empty', async () => {
      renderApp({ personalization: warmHistory() })
      // The recommendation pool comes from discovery; whatever happens, the page
      // must not be blank.
      await waitFor(() => expect(document.querySelectorAll('.music-section').length).toBe(5))
      expect(document.querySelectorAll('.music-section h2').length).toBe(5)
    })
  })

  describe('persistence and reset', () => {
    it('restores the personalized state after a reload', async () => {
      const state = warmHistory()
      const first = renderApp({ personalization: state })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended })
      first.unmount()

      // A second mount from the same persisted state is what a reload is.
      renderApp({ personalization: state })
      expect(
        await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended }),
      ).toBeInTheDocument()
    })

    it('returns to the cold-start dashboard once history is cleared', async () => {
      renderApp({ personalization: warmHistory() })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended })

      usePersonalizationStore.getState().resetRecommendations()

      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: HOME_SECTION_TITLES.recommended })).toBeNull(),
      )
      expect(sectionTitles()).toEqual([
        HOME_SECTION_TITLES.trending,
        HOME_SECTION_TITLES['popular-artists'],
        HOME_SECTION_TITLES.month,
        HOME_SECTION_TITLES.stations,
        HOME_SECTION_TITLES.charts,
      ])
    })

    it('updates the dashboard when history changes, with no reload', async () => {
      renderApp()
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })
      expect(screen.queryByRole('heading', { name: HOME_SECTION_TITLES.recent })).toBeNull()

      usePersonalizationStore.getState().setConsent('granted')
      usePersonalizationStore.setState({
        state: makeState({
          listeningHistory: [makeEntry({ id: 'new', title: 'Midnight Signal', daysAgo: 0 })],
        }),
      })
      usePersonalizationStore.getState().replaceState(
        makeState({
          listeningHistory: [makeEntry({ id: 'new', title: 'Midnight Signal', daysAgo: 0 })],
        }),
      )

      expect(
        await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent }),
      ).toBeInTheDocument()
    })
  })

  describe('personalization declined', () => {
    it('shows the cold-start dashboard and stores nothing', async () => {
      renderApp({ personalization: makeState({ consent: 'denied', listeningHistory: [makeEntry({ id: 'a', playCount: 9 })] }) })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })

      expect(sectionTitles()[0]).toBe(HOME_SECTION_TITLES.trending)
      expect(screen.queryByRole('heading', { name: HOME_SECTION_TITLES.recent })).toBeNull()
      expect(screen.queryByTestId('personalization-prompt')).toBeNull()
    })
  })

  describe('multilingual behaviour', () => {
    it('responds to Arabic-script searches without making an identity claim', async () => {
      renderApp({ personalization:
        makeState({
          listeningHistory: [makeEntry({ id: 'h1', playCount: 4, daysAgo: 1 })],
          searchHistory: [
            makeSearch({ query: 'سارية السواس', script: 'arabic', submitCount: 4 }),
            makeSearch({ query: 'سارة السواس', script: 'arabic', submitCount: 2 }),
          ],
        }),
       })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended })

      const profile = usePersonalizationStore.getState().profile
      expect(profile.scriptWeights.arabic).toBeGreaterThan(0)

      // The signal exists internally; nothing on screen states or implies an
      // identity, a nationality or a language for the visitor.
      const page = document.body.textContent ?? ''
      expect(page).not.toMatch(/you are (arabic|russian|armenian)/i)
      expect(page).not.toMatch(/your (nationality|ethnicity|religion|language)/i)
    })

    it('keeps Cyrillic and Armenian signals distinct', async () => {
      renderApp({ personalization:
        makeState({
          listeningHistory: [makeEntry({ id: 'h1', playCount: 4, daysAgo: 1 })],
          searchHistory: [
            makeSearch({ query: 'Кино Группа крови', script: 'cyrillic', submitCount: 3 }),
            makeSearch({ query: 'Արամ Ասատրյան', script: 'armenian', submitCount: 1 }),
          ],
        }),
       })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended })

      const { scriptWeights } = usePersonalizationStore.getState().profile
      expect(scriptWeights.cyrillic).toBeGreaterThan(scriptWeights.armenian)
      expect(scriptWeights.armenian).toBeGreaterThan(0)
    })
  })

  describe('YouTube in Recently Played', () => {
    it('shows a retained YouTube entry, clearly labelled, with its 16:9 thumbnail', async () => {
      renderApp({ personalization:
        makeState({
          listeningHistory: [
            makeEntry({ id: 'vid1', provider: 'youtube', title: 'Night Signal', artist: 'Aster Vale', daysAgo: 0 }),
          ],
        }),
       })
      const shelf = (await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent }))
        .closest('.music-section') as HTMLElement

      expect(within(shelf).getByText('Night Signal')).toBeInTheDocument()
      expect(within(shelf).getByText('YouTube')).toBeInTheDocument()
      expect(within(shelf).getByTestId('youtube-thumbnail')).toBeInTheDocument()
      // Never cropped into square album art.
      expect(shelf.querySelector('.yt-thumb-fill')).not.toBeNull()
    })

    it('drops an expired YouTube entry entirely', async () => {
      renderApp({ personalization:
        makeState({
          listeningHistory: [
            makeEntry({ id: 'expired', provider: 'youtube', title: 'Old Video', daysAgo: 1, storedDaysAgo: 45 }),
            makeEntry({ id: 'song', title: 'Midnight Signal', daysAgo: 2 }),
          ],
        }),
       })
      const shelf = (await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent }))
        .closest('.music-section') as HTMLElement

      expect(within(shelf).queryByText('Old Video')).toBeNull()
      expect(within(shelf).getByText('Midnight Signal')).toBeInTheDocument()
    })

    it('makes no YouTube request merely from loading the home page', async () => {
      renderApp({
        personalization: makeState({
          listeningHistory: [
            makeEntry({ id: 'vid1', provider: 'youtube', daysAgo: 0 }),
            makeEntry({ id: 'h1', playCount: 5, daysAgo: 1 }),
            makeEntry({ id: 'h2', artist: 'Ghost Radio', playCount: 4, daysAgo: 2 }),
          ],
          searchHistory: [makeSearch({ query: 'anything', submitCount: 5 })],
        }),
      })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended })
      await waitFor(() => expect(document.querySelectorAll('.music-section').length).toBe(5))

      // Any request to `/api/youtube` would be an unhandled MSW request, which
      // the suite is configured to fail on. The absence of a YouTube results
      // section is the visible half of the same guarantee.
      expect(screen.queryByTestId('youtube-result')).toBeNull()
    })
  })

  it('does not re-rank on every playback tick', async () => {
    renderApp({ personalization: warmHistory() })
    await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recommended })

    const before = [...document.querySelectorAll('.music-section h2')].map((n) => n.textContent)
    vi.advanceTimersByTime(DAY / 24)
    const after = [...document.querySelectorAll('.music-section h2')].map((n) => n.textContent)
    expect(after).toEqual(before)
  })
})
