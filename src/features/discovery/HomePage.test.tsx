import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { AUDIUS_BASE, errorHandlers } from '@/test/msw/handlers'
import { trackListResponse } from '@/test/fixtures/audius'
import { server } from '@/test/msw/server'
import { renderApp } from '@/test/render'
import { usePlayerStore } from '@/player/player-store'
import { SHELF_TITLES } from './shelves'

/** The trending and "this month" shelves share fixture tracks, so shelf-scoped
 *  queries are required to address one card unambiguously. */
async function trendingShelf(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: SHELF_TITLES.trending })
  return heading.closest('.music-section') as HTMLElement
}

describe('discovery home', () => {
  it('renders the reference shelves in the reference order', async () => {
    renderApp()
    await screen.findByRole('heading', { name: SHELF_TITLES.trending })

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((node) => node.textContent)
      .filter((text): text is string => Object.values(SHELF_TITLES).includes(text ?? ''))

    expect(headings).toEqual([
      SHELF_TITLES.trending,
      SHELF_TITLES.artists,
      SHELF_TITLES.month,
      SHELF_TITLES.stations,
      SHELF_TITLES.charts,
    ])
  })

  it('fills the trending shelf with real provider tracks', async () => {
    renderApp()
    const shelf = await screen.findByRole('heading', { name: SHELF_TITLES.trending })
    const section = shelf.closest('.music-section')!
    await waitFor(() =>
      expect(within(section as HTMLElement).getByText('Midnight Signal')).toBeInTheDocument(),
    )
    // Four cards, exactly as the reference renders.
    expect(section.querySelectorAll('.media-card')).toHaveLength(4)
  })

  it('shows real artists, skipping deactivated profiles', async () => {
    renderApp()
    expect(await screen.findByRole('button', { name: 'Search for Nova Sound' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Deactivated Artist/ })).not.toBeInTheDocument()
  })

  it('starts real playback from a shelf card and uses the shelf as the queue', async () => {
    const { user, engine } = renderApp()
    const shelf = await trendingShelf()
    const card = await within(shelf).findByRole('button', {
      name: /^Play Midnight Signal by Nova Sound$/,
    })
    await user.click(card)

    await waitFor(() => expect(engine.playing).toBe(true))
    const state = usePlayerStore.getState()
    expect(state.currentTrack?.title).toBe('Midnight Signal')
    expect(state.queueContext?.label).toBe(SHELF_TITLES.trending)
    // The gated fixture track is excluded from the queue.
    expect(state.queue.every((track) => track.isStreamable)).toBe(true)
    expect(state.queue.length).toBeGreaterThan(1)
  })

  it('keeps the shell and search usable when a shelf fails, and offers a retry', async () => {
    server.use(errorHandlers.trendingServerError)
    renderApp()

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Search songs and artists')).toBeEnabled()
    expect(within(alerts[0]).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // A failing shelf must not take the rest of the page down.
    expect(await screen.findByRole('button', { name: 'Search for Nova Sound' })).toBeInTheDocument()
  })

  it('reloads a failed shelf when the retry succeeds', async () => {
    server.use(errorHandlers.trendingServerError)
    const { user } = renderApp()

    const retry = (await screen.findAllByRole('button', { name: 'Try again' }))[0]
    server.resetHandlers()
    await user.click(retry)

    const shelf = await trendingShelf()
    expect(
      await within(shelf).findByRole('button', { name: /^Play Midnight Signal by Nova Sound$/ }),
    ).toBeInTheDocument()
  })

  it('renders every station tile with the reference tone classes', async () => {
    const { container } = renderApp()
    await screen.findByRole('heading', { name: SHELF_TITLES.stations })
    const covers = container.querySelectorAll('.station-cover')
    expect(covers).toHaveLength(4)
    expect([...covers].map((node) => node.className)).toEqual([
      'station-cover lavender',
      'station-cover pink',
      'station-cover rose',
      'station-cover amber',
    ])
  })

  it('renders every chart tile with the reference gradient classes', async () => {
    const { container } = renderApp()
    await screen.findByRole('heading', { name: SHELF_TITLES.charts })
    expect([...container.querySelectorAll('.chart-cover')].map((n) => n.className)).toEqual([
      'chart-cover global',
      'chart-cover usa',
      'chart-cover top50',
      'chart-cover top50usa',
    ])
  })

  it('plays a chart on demand rather than prefetching every chart at load', async () => {
    let chartRequests = 0
    server.use(
      http.get(`${AUDIUS_BASE}/v1/tracks/trending`, ({ request }) => {
        if (new URL(request.url).searchParams.get('time') === 'week') chartRequests += 1
        return HttpResponse.json(trackListResponse())
      }),
    )
    const { user, engine } = renderApp()

    const chart = await screen.findByRole('button', { name: /Play Trending This Week/i })
    expect(chartRequests).toBe(0)

    await user.click(chart)
    await waitFor(() => expect(engine.playing).toBe(true))
    expect(chartRequests).toBe(1)
  })

  it('requests each shelf once, not once per mounted consumer', async () => {
    let trendingRequests = 0
    server.use(
      http.get(`${AUDIUS_BASE}/v1/tracks/trending`, ({ request }) => {
        const params = new URL(request.url).searchParams
        if (!params.get('genre') && !params.get('time')) trendingRequests += 1
        return HttpResponse.json(trackListResponse())
      }),
    )
    renderApp()
    const shelf = await trendingShelf()
    await within(shelf).findByRole('button', { name: /^Play Midnight Signal by Nova Sound$/ })
    // Header, banner and home page all read the same cached shelf.
    expect(trendingRequests).toBe(1)
  })

  it('does not autoplay anything on first load', async () => {
    const { engine } = renderApp()
    await screen.findByRole('heading', { name: SHELF_TITLES.trending })
    expect(engine.playing).toBe(false)
    expect(usePlayerStore.getState().status).toBe('idle')
  })
})
