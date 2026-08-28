import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { jamendoHandlers, youtubeHandlers } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'
import { youtubePayload } from '@/test/fixtures/youtube'
import { makeJamendoTrack } from '@/test/fixtures/jamendo'
import { renderApp } from '@/test/render'

/**
 * The automatic YouTube fallback, and the line it must not cross.
 *
 * The reported bug: searching `sara al sawas` showed *No strong matches found.*
 * with a **Search YouTube** button and **zero** `/api/youtube` requests in the
 * Network panel, even though the endpoint returns eight real results when
 * called directly. Nothing observed `hasStrongOpenCatalogMatch === false` — the
 * only route to a request was the button's `onClick`.
 *
 * The fix must satisfy two requirements that pull in opposite directions:
 *
 * · an **explicit submission** that finds nothing should search YouTube on its
 *   own, so nobody has to press a second button;
 * · **search-as-you-type must still cost nothing**, because a visitor typing
 *   `sara al sawas` settles the debounce several times on the way and the whole
 *   deployment only gets 100 YouTube searches a day.
 *
 * Every request in this file is counted. MSW is configured with
 * `onUnhandledRequest: 'error'` and there is no default `/api/youtube` handler,
 * so a stray request in a test that registered none fails that test outright.
 */

const youtubeRows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="youtube-result"]')]

/** Types a query and presses Enter — the app's explicit search submission. */
async function submitSearch(user: ReturnType<typeof renderApp>['user'], query: string) {
  const field = screen.getByLabelText('Search songs and artists')
  await user.clear(field)
  await user.type(field, query)
  await user.keyboard('{Enter}')
}

/** The three real Jamendo rows for `aram asatryan` — none is a strong match. */
const ARAM_NOISE = [
  makeJamendoTrack({ id: 'n1', title: "Eternos Rivales - Fil d'aram", artistName: 'Eternos Rivales' }),
  makeJamendoTrack({ id: 'n2', title: '01. Météo sombre (prod. Aram)', artistName: 'L.IAM' }),
  makeJamendoTrack({ id: 'n3', title: 'Orom Aram', artistName: 'Joël Vanoli' }),
]

/** Realistic YouTube rows, in the shape `/api/youtube` really returns. */
const SAWAS_VIDEOS = [
  youtubePayload({
    videoId: 'sawas000001',
    title: 'Saria Al Sawas - Bas asmae Mini video clip',
    channelTitle: 'Saria Al Sawas',
  }),
  youtubePayload({
    videoId: 'sawas000002',
    title: 'Saria Al Sawas feat. Kosaik Haulii - Wajeh El Goumar',
    channelTitle: 'Saria Al Sawas',
  }),
  youtubePayload({
    videoId: 'sawas000003',
    title: 'Ma Mallet',
    channelTitle: 'Saria Al Sawas - Topic',
  }),
]

const ARAM_VIDEOS = [
  youtubePayload({ videoId: 'aram0000001', title: 'Aram Asatryan   Barov Ari', channelTitle: 'zeytun818' }),
  youtubePayload({
    videoId: 'aram0000002',
    title: 'Lusnyak Gishernere',
    channelTitle: 'Aram Asatryan - Topic',
  }),
]

/* ------------------------------------------------- the reported regression */

describe('sara al sawas — the reported bug', () => {
  it('makes zero YouTube requests while the query is only being typed', async () => {
    // No YouTube handler at all: any request fails this test.
    server.use(jamendoHandlers.withResults([]))
    const { user } = renderApp({ route: '/' })

    const field = screen.getByLabelText('Search songs and artists')
    await user.type(field, 'sara al sawas')

    // The debounced Audius + Jamendo search runs and settles with nothing.
    expect(await screen.findByText(/No strong matches found|No matching music yet/)).toBeInTheDocument()
    expect(screen.queryByTestId('youtube-results')).not.toBeInTheDocument()
    // The manual control is still offered — typing never removes it.
    expect(screen.getByTestId('youtube-fallback')).toBeInTheDocument()
  })

  it('makes exactly one YouTube request after an explicit submission finds nothing', async () => {
    const calls: string[] = []
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.counting(calls, SAWAS_VIDEOS))
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, 'sara al sawas')

    await waitFor(() => expect(youtubeRows()).toHaveLength(3))
    expect(calls).toEqual(['sara al sawas'])
  })

  it('renders the real YouTube rows automatically, with no second click', async () => {
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.withResults(SAWAS_VIDEOS))
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, 'sara al sawas')

    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))
    expect(screen.getByRole('heading', { name: /YouTube results/i })).toBeInTheDocument()
    expect(screen.getByText('Saria Al Sawas - Bas asmae Mini video clip')).toBeInTheDocument()
    expect(screen.getByText(/Wajeh El Goumar/)).toBeInTheDocument()
  })

  it('shows a searching state instead of flashing the failure screen', async () => {
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.withResults(SAWAS_VIDEOS))
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, 'sara al sawas')

    // The moment the catalogues settle empty, the page says what it is doing.
    // It must never claim the whole search failed while YouTube is pending.
    await screen.findByText(/Searching YouTube/i)
    expect(screen.queryByText('No strong matches found.')).not.toBeInTheDocument()

    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))
  })
})

describe('aram asatryan — the same flow with weak open-catalog noise', () => {
  it('makes zero YouTube requests while typing, even with weak rows returned', async () => {
    server.use(jamendoHandlers.withResults(ARAM_NOISE))
    const { user } = renderApp({ route: '/' })

    await user.type(screen.getByLabelText('Search songs and artists'), 'aram asatryan')

    expect(await screen.findByText('No strong matches found.')).toBeInTheDocument()
    expect(screen.queryByTestId('youtube-results')).not.toBeInTheDocument()
  })

  it('makes exactly one YouTube request after explicit submission', async () => {
    const calls: string[] = []
    server.use(jamendoHandlers.withResults(ARAM_NOISE), youtubeHandlers.counting(calls, ARAM_VIDEOS))
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, 'aram asatryan')

    await waitFor(() => expect(youtubeRows()).toHaveLength(2))
    expect(calls).toEqual(['aram asatryan'])
    expect(screen.getByText(/Barov Ari/)).toBeInTheDocument()
    // The weak Jamendo rows are still not promoted to Top Result.
    expect(screen.queryByRole('heading', { name: 'Top result' })).not.toBeInTheDocument()
  })
})

/* ------------------------------------------------------ the strong-match path */

describe('Adele Hello — a strong open-catalog match', () => {
  const ADELE = [makeJamendoTrack({ id: 'a1', title: 'Hello', artistName: 'Adele' })]

  it('makes zero automatic YouTube requests', async () => {
    // No YouTube handler: an automatic request here fails the test.
    server.use(jamendoHandlers.withResults(ADELE))
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, 'adele hello')

    expect(await screen.findByRole('heading', { name: 'Top result' })).toBeInTheDocument()
    expect(screen.getByTestId('youtube-fallback-more')).toBeInTheDocument()
    expect(screen.queryByTestId('youtube-results')).not.toBeInTheDocument()
  })

  it('still searches YouTube manually, exactly once, on the subtle control', async () => {
    const calls: string[] = []
    server.use(jamendoHandlers.withResults(ADELE), youtubeHandlers.counting(calls))
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, 'adele hello')
    await screen.findByRole('heading', { name: 'Top result' })
    expect(calls).toHaveLength(0)

    await user.click(screen.getByTestId('youtube-fallback-more'))

    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))
    expect(calls).toEqual(['adele hello'])
  })
})

/* ------------------------------------------------------------ quota safety */

describe('one submission spends at most one search', () => {
  it('does not repeat the request when the component re-renders', async () => {
    const calls: string[] = []
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.counting(calls, SAWAS_VIDEOS))
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, 'sara al sawas')
    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))

    // Force plenty of re-renders through unrelated app state.
    await user.click(screen.getAllByRole('button', { name: /queue/i })[0])
    await user.keyboard('{Escape}')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(calls).toEqual(['sara al sawas'])
  })

  it('does not double-fire under StrictMode', async () => {
    // `main.tsx` renders under StrictMode, which deliberately invokes every
    // effect twice. A quota-spending effect must survive that.
    const calls: string[] = []
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.counting(calls, SAWAS_VIDEOS))
    const { user } = renderApp({ route: '/', strict: true })

    await submitSearch(user, 'sara al sawas')

    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))
    expect(calls).toEqual(['sara al sawas'])
  })

  it('submitting the same query twice costs one upstream search', async () => {
    const calls: string[] = []
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.counting(calls, SAWAS_VIDEOS))
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, 'sara al sawas')
    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))

    // A second Enter is a second submission — answered from the session cache.
    await user.click(screen.getByLabelText('Search songs and artists'))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))

    expect(calls).toHaveLength(1)
  })

  it('never retries automatically after a YouTube failure', async () => {
    // Only the failing handler: MSW resolves the first matching one, so a
    // counting handler registered alongside it would answer instead.
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.serverError())
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, 'sara al sawas')

    expect(await screen.findByText(/Audius and Jamendo results are unaffected/i)).toBeInTheDocument()
    // The manual control comes back so a person can retry deliberately.
    expect(screen.getByTestId('youtube-fallback')).toBeInTheDocument()

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(youtubeRows()).toHaveLength(0)
  })

  it('clears stale YouTube results when the query changes', async () => {
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.withResults(SAWAS_VIDEOS))
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, 'sara al sawas')
    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))

    // Typing a new query must not leave the previous query's videos on screen,
    // and must not spend a search of its own.
    const field = screen.getByLabelText('Search songs and artists')
    await user.clear(field)
    await user.type(field, 'midnight')

    await waitFor(() => expect(youtubeRows()).toHaveLength(0))
  })
})

/* --------------------------------------------------------------- Unicode */

describe('the submitted query reaches YouTube byte-for-byte', () => {
  it.each([
    ['Arabic', 'سارة السواس'],
    ['Armenian', 'Արամ Ասատրյան'],
    ['Cyrillic', 'Кино Группа крови'],
  ])('preserves a %s query through automatic fallback', async (_script, query) => {
    const calls: string[] = []
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.counting(calls, SAWAS_VIDEOS))
    const { user } = renderApp({ route: '/' })

    await submitSearch(user, query)

    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))
    expect(calls).toEqual([query])
  })
})
