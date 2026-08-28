import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { jamendoHandlers, youtubeHandlers } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'
import { YOUTUBE_PAYLOADS, youtubePayload } from '@/test/fixtures/youtube'
import { makeJamendoTrack } from '@/test/fixtures/jamendo'
import { renderApp } from '@/test/render'

/**
 * The YouTube fallback, end to end through the real hook, the real client and
 * the real `/api/youtube` wire contract — only the network is doubled.
 *
 * **The most important assertions in this file are the ones that expect nothing
 * to happen.** MSW is configured with `onUnhandledRequest: 'error'` and there is
 * deliberately no default handler for `/api/youtube`, so any test that does not
 * call `server.use(youtubeHandlers…)` will fail loudly if a YouTube request
 * escapes. That is the 100-searches-a-day budget expressed as infrastructure
 * (docs/youtube-policy-audit.md §1).
 */

const fallbackButton = () => screen.getByTestId('youtube-fallback')
const youtubeRows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="youtube-result"]')]

describe('quota discipline', () => {
  it('spends nothing on an ordinary search that finds results', async () => {
    // No YouTube handler registered: a request here fails the test.
    renderApp({ route: '/search?q=midnight' })
    expect(await screen.findByRole('heading', { name: 'Songs' })).toBeInTheDocument()
    expect(screen.queryByTestId('youtube-results')).not.toBeInTheDocument()
  })

  it('spends nothing on the discovery home page', async () => {
    renderApp({ route: '/' })
    await waitFor(() => expect(screen.getAllByRole('heading').length).toBeGreaterThan(1))
  })

  it('spends nothing while typing — the fallback is a button, not a keystroke', async () => {
    const { user } = renderApp({ route: '/' })
    const field = screen.getByLabelText('Search songs and artists')
    await user.type(field, 'sirusho')
    // The debounced Audius/Jamendo search runs; YouTube does not.
    await waitFor(() => expect(field).toHaveValue('sirusho'))
    expect(screen.queryByTestId('youtube-results')).not.toBeInTheDocument()
  })

  it('spends exactly one search per deliberate press', async () => {
    const calls: string[] = []
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.counting(calls))
    const { user } = renderApp({ route: '/search?q=nothing at all' })

    await user.click(await screen.findByTestId('youtube-fallback'))
    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))
    expect(calls).toEqual(['nothing at all'])
  })

  it('answers a repeated press from the session cache, at no quota cost', async () => {
    // YouTube answers with nothing, which is what keeps the manual control on
    // screen for a second press: once it finds rows, the empty state and its
    // button give way to the results section.
    const calls: string[] = []
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.counting(calls, []))
    const { user } = renderApp({ route: '/search?q=nothing at all' })

    await user.click(await screen.findByTestId('youtube-fallback'))
    expect(await screen.findByText(/No YouTube videos matched/i)).toBeInTheDocument()

    await user.click(screen.getByTestId('youtube-fallback'))
    await waitFor(() => expect(screen.getByText(/No YouTube videos matched/i)).toBeInTheDocument())

    expect(calls).toHaveLength(1)
  })

  it('never fans out over aliases or transliterations', async () => {
    const calls: string[] = []
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.counting(calls))
    const { user } = renderApp({ route: '/search?q=Սիրուշո' })

    await user.click(await screen.findByTestId('youtube-fallback'))
    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))

    // One request, carrying the literal Armenian query and nothing else.
    expect(calls).toEqual(['Սիրուշո'])
  })

  it('never paginates automatically', async () => {
    const calls: string[] = []
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.counting(calls))
    const { user } = renderApp({ route: '/search?q=nothing at all' })
    await user.click(await screen.findByTestId('youtube-fallback'))
    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: /load more|next page/i })).not.toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })
})

describe('where the fallback is offered', () => {
  it('offers it when nothing matched', async () => {
    server.use(jamendoHandlers.withResults([]))
    renderApp({ route: '/search?q=nothing at all' })
    expect(await screen.findByTestId('youtube-fallback')).toBeInTheDocument()
    expect(fallbackButton()).toHaveAccessibleName(/Search YouTube/i)
  })

  it('offers the subtle variant alongside good results', async () => {
    renderApp({ route: '/search?q=midnight' })
    expect(await screen.findByRole('heading', { name: 'Songs' })).toBeInTheDocument()
    expect(screen.getByTestId('youtube-fallback-more')).toHaveTextContent(/Search YouTube for more/i)
    // The prominent prompt is only for the empty case.
    expect(screen.queryByTestId('youtube-fallback')).not.toBeInTheDocument()
  })

  it('is a real button, reachable by keyboard', async () => {
    server.use(jamendoHandlers.withResults([]))
    renderApp({ route: '/search?q=nothing at all' })
    const button = await screen.findByTestId('youtube-fallback')
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('is not offered while the catalogues are still answering', () => {
    renderApp({ route: '/search?q=midnight' })
    expect(screen.queryByTestId('youtube-fallback')).not.toBeInTheDocument()
    expect(screen.queryByTestId('youtube-fallback-more')).not.toBeInTheDocument()
  })
})

describe('the YouTube results section', () => {
  async function openFallback(route = '/search?q=nothing at all') {
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.withResults())
    const harness = renderApp({ route })
    await harness.user.click(await screen.findByTestId('youtube-fallback'))
    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))
    return harness
  }

  it('is separately labelled and never merged into Songs', async () => {
    await openFallback()
    expect(screen.getByRole('heading', { name: /YouTube results/i })).toBeInTheDocument()
    // The audio list is untouched — a YouTube video is not a song row.
    expect(document.querySelectorAll('.song-row')).toHaveLength(0)
  })

  it('attributes every row to YouTube, with a direct watch link', async () => {
    await openFallback()
    for (const row of youtubeRows()) {
      const link = within(row).getByRole('link', { name: /Watch .* on YouTube/i })
      expect(link).toHaveAttribute('href', expect.stringContaining('https://www.youtube.com/watch?v='))
      expect(link).toHaveTextContent('YouTube')
      expect(link).toHaveAttribute('target', '_blank')
    }
  })

  it('never uses rel="noreferrer", which would suppress the required Referer', async () => {
    await openFallback()
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="youtube.com"]')) {
      expect(link.rel).not.toContain('noreferrer')
      expect(link.rel).toContain('noopener')
    }
  })

  it('shows the channel title and the duration', async () => {
    await openFallback()
    const row = youtubeRows()[0]
    expect(within(row).getByText('Sirusho')).toBeInTheDocument()
    expect(within(row).getByText('3:33')).toBeInTheDocument()
  })

  it('shows an unmodified 16:9 thumbnail, never cropped into square art', async () => {
    await openFallback()
    const thumb = within(youtubeRows()[0]).getByTestId('youtube-thumbnail')
    // The box is 16:9 …
    expect(thumb.style.width).toBe('80px')
    expect(thumb.style.height).toBe('45px')
    // … and the image inside it is YouTube's own, at its own dimensions.
    const image = thumb.querySelector('img')!
    expect(image.getAttribute('src')).toContain('i.ytimg.com')
    expect(image.getAttribute('width')).toBe('1280')
    expect(image.getAttribute('height')).toBe('720')
  })

  it('says so, in words, when nothing matched on YouTube either', async () => {
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.withResults([]))
    const { user } = renderApp({ route: '/search?q=nothing at all' })
    await user.click(await screen.findByTestId('youtube-fallback'))
    expect(await screen.findByText(/No YouTube videos matched/i)).toBeInTheDocument()
  })
})

describe('made-for-kids and non-embeddable results', () => {
  async function openFallback() {
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.withResults(YOUTUBE_PAYLOADS))
    const harness = renderApp({ route: '/search?q=nothing at all' })
    await harness.user.click(await screen.findByTestId('youtube-fallback'))
    await waitFor(() => expect(youtubeRows().length).toBe(4))
    return harness
  }

  it('keeps a made-for-kids result visible, attributed and openable on YouTube', async () => {
    await openFallback()
    const row = youtubeRows().find((r) => within(r).queryByText('Kids Song Collection'))!
    expect(row).toBeDefined()
    expect(within(row).getByRole('link', { name: /Watch .* on YouTube/i })).toBeInTheDocument()
    expect(within(row).getByText(/made for kids/i)).toBeInTheDocument()
  })

  it('offers no in-app play control for it', async () => {
    await openFallback()
    const row = youtubeRows().find((r) => within(r).queryByText('Kids Song Collection'))!
    expect(row.dataset.embeddable).toBe('false')
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('never opens the player for it, even if the row is clicked', async () => {
    const { user, youtube } = await openFallback()
    const row = youtubeRows().find((r) => within(r).queryByText('Kids Song Collection'))!
    await user.click(row)
    expect(screen.queryByTestId('youtube-surface')).not.toBeInTheDocument()
    expect(youtube.created).toBe(0)
  })

  it('treats a non-embeddable video the same way, and says why', async () => {
    await openFallback()
    const row = youtubeRows().find((r) => within(r).queryByText('Embedding Disabled Live Set'))!
    expect(row.dataset.embeddable).toBe('false')
    expect(within(row).getByText(/turned off embedding/i)).toBeInTheDocument()
  })

  it('still plays an ordinary result normally', async () => {
    const { user, youtube } = await openFallback()
    const row = youtubeRows().find((r) => within(r).queryByText('Qele Qele'))!
    expect(row.dataset.embeddable).toBe('true')
    await user.click(within(row).getByRole('button'))
    await waitFor(() => expect(youtube.created).toBe(1))
    expect(youtube.current()?.videoId).toBe('aaaaaaaaaaa')
  })
})

describe('degraded YouTube states', () => {
  it('says the feature is unavailable when no key is configured', async () => {
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.unavailable())
    const { user } = renderApp({ route: '/search?q=nothing at all' })
    await user.click(await screen.findByTestId('youtube-fallback'))
    expect(await screen.findByText(/not available on this deployment/i)).toBeInTheDocument()
  })

  it('keeps Audius and Jamendo fully working when YouTube is unavailable', async () => {
    server.use(youtubeHandlers.unavailable())
    const { user } = renderApp({ route: '/search?q=midnight' })
    expect(await screen.findByRole('heading', { name: 'Songs' })).toBeInTheDocument()
    const rowsBefore = document.querySelectorAll('.song-row').length
    await user.click(screen.getByTestId('youtube-fallback-more'))
    await screen.findByText(/not available on this deployment/i)
    expect(document.querySelectorAll('.song-row')).toHaveLength(rowsBefore)
  })

  it('shows the documented quota message and does not retry', async () => {
    const calls: string[] = []
    server.use(
      jamendoHandlers.withResults([]),
      youtubeHandlers.quotaExceeded(),
      youtubeHandlers.counting(calls),
    )
    server.use(youtubeHandlers.quotaExceeded())
    const { user } = renderApp({ route: '/search?q=nothing at all' })
    await user.click(await screen.findByTestId('youtube-fallback'))
    expect(
      await screen.findByText('YouTube search is temporarily unavailable. Try again later.'),
    ).toBeInTheDocument()
  })

  it('reports an upstream problem without blaming the visitors query', async () => {
    server.use(jamendoHandlers.withResults([]), youtubeHandlers.serverError())
    const { user } = renderApp({ route: '/search?q=nothing at all' })
    await user.click(await screen.findByTestId('youtube-fallback'))
    expect(await screen.findByText(/Audius and Jamendo results are unaffected/i)).toBeInTheDocument()
  })

  it('discards YouTube results when the query changes', async () => {
    server.use(
      jamendoHandlers.withResults([]),
      youtubeHandlers.withResults([youtubePayload({ title: 'Qele Qele' })]),
    )
    const { user, rerender: _rerender } = renderApp({ route: '/search?q=nothing at all' })
    await user.click(await screen.findByTestId('youtube-fallback'))
    await waitFor(() => expect(youtubeRows().length).toBe(1))

    // A new search must not leave the previous query's videos on screen.
    const field = screen.getByLabelText('Search songs and artists')
    await user.clear(field)
    await user.type(field, 'midnight')
    await waitFor(() => expect(youtubeRows()).toHaveLength(0))
  })
})

/* ---------------------------------------- open-catalog confidence → UI state */

describe('the fallback follows open-catalog confidence, not row count', () => {
  /**
   * The three rows the live Jamendo catalogue really returned for
   * `aram asatryan`. Each scores 0.375 on the single generic token `aram`.
   *
   * Before the coverage rule one of them became Top Result — telling the
   * visitor their artist had been found — and the presence of *any* row pushed
   * the YouTube fallback into its subtle variant. Both are now wrong by
   * construction.
   */
  const ARAM_NOISE = [
    makeJamendoTrack({ id: 'n1', title: "Eternos Rivales - Fil d'aram", artistName: 'Eternos Rivales' }),
    makeJamendoTrack({ id: 'n2', title: '01. Météo sombre (prod. Aram)', artistName: 'L.IAM' }),
    makeJamendoTrack({ id: 'n3', title: 'Orom Aram', artistName: 'Joël Vanoli' }),
  ]

  it('shows the prominent Search YouTube when only weak rows came back', async () => {
    server.use(jamendoHandlers.withResults(ARAM_NOISE))
    renderApp({ route: '/search?q=aram asatryan' })

    expect(await screen.findByTestId('youtube-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('youtube-fallback-more')).not.toBeInTheDocument()
  })

  it('promotes none of those rows to Top Result', async () => {
    server.use(jamendoHandlers.withResults(ARAM_NOISE))
    renderApp({ route: '/search?q=aram asatryan' })

    await screen.findByTestId('youtube-fallback')
    expect(screen.queryByRole('heading', { name: 'Top result' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Songs' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.song-row')).toHaveLength(0)
    for (const title of ["Eternos Rivales - Fil d'aram", '01. Météo sombre (prod. Aram)', 'Orom Aram']) {
      expect(screen.queryByText(title)).not.toBeInTheDocument()
    }
  })

  it('says plainly that the open catalogues had nothing strong', async () => {
    server.use(jamendoHandlers.withResults(ARAM_NOISE))
    renderApp({ route: '/search?q=aram asatryan' })

    await screen.findByTestId('youtube-fallback')
    expect(screen.getByText(/No strong matches found/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Nothing in the Audius or Jamendo catalogues strongly matched/i),
    ).toBeInTheDocument()
  })

  it('still spends zero YouTube requests while showing that state', async () => {
    // No YouTube handler is registered, and MSW is set to `onUnhandledRequest:
    // 'error'` — so a single stray request would fail this test outright.
    server.use(jamendoHandlers.withResults(ARAM_NOISE))
    renderApp({ route: '/search?q=aram asatryan' })

    await screen.findByTestId('youtube-fallback')
    expect(screen.queryByTestId('youtube-results')).not.toBeInTheDocument()
  })

  it('runs exactly one YouTube search when the visitor presses the button', async () => {
    const calls: string[] = []
    server.use(jamendoHandlers.withResults(ARAM_NOISE), youtubeHandlers.counting(calls))
    const { user } = renderApp({ route: '/search?q=aram asatryan' })

    await user.click(await screen.findByTestId('youtube-fallback'))
    await waitFor(() => expect(youtubeRows().length).toBeGreaterThan(0))

    expect(calls).toEqual(['aram asatryan'])
  })

  it('shows normal results and only the subtle variant when a real match exists', async () => {
    server.use(
      jamendoHandlers.withResults([
        ...ARAM_NOISE,
        makeJamendoTrack({ id: 'g1', title: 'Barov Ari', artistName: 'Aram Asatryan' }),
      ]),
    )
    renderApp({ route: '/search?q=aram asatryan' })

    expect(await screen.findByRole('heading', { name: 'Top result' })).toBeInTheDocument()
    expect(screen.getByTestId('youtube-fallback-more')).toBeInTheDocument()
    expect(screen.queryByTestId('youtube-fallback')).not.toBeInTheDocument()

    // Only the genuine row survives; the noise is filtered out of the list.
    expect(document.querySelectorAll('.song-row')).toHaveLength(1)
    expect(screen.getAllByText('Barov Ari').length).toBeGreaterThan(0)
  })
})
