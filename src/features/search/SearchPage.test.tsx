import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { AUDIUS_BASE, errorHandlers, jamendoHandlers } from '@/test/msw/handlers'
import { RAW_TRACKS, catalogSearchResponse, makeRawTrack } from '@/test/fixtures/audius'
import { server } from '@/test/msw/server'
import { renderApp, rowFor } from '@/test/render'

describe('search results', () => {
  it('renders real provider results with a top result and a song list', async () => {
    renderApp({ route: '/search?q=midnight' })

    expect(await screen.findByRole('heading', { name: /Results for/i })).toBeInTheDocument()
    const topResult = await screen.findByRole('heading', { level: 3, name: 'Midnight Signal' })
    expect(topResult).toBeInTheDocument()

    const rows = await screen.findAllByRole('button', { name: /^Play .* by /i })
    expect(rows.length).toBeGreaterThan(0)
    // The artist name appears on both the top-result card and its list row.
    expect(screen.getAllByText('Nova Sound').length).toBeGreaterThan(0)
  })

  it('shows a loading state before results arrive', async () => {
    server.use(
      http.get(`${AUDIUS_BASE}/v1/search/full`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
        return HttpResponse.json(catalogSearchResponse())
      }),
    )
    renderApp({ route: '/search?q=midnight' })

    expect(await screen.findByTestId('track-list-skeleton')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('track-list-skeleton')).not.toBeInTheDocument())
  })

  it('shows the reference no-results state for an empty result set', async () => {
    renderApp({ route: '/search?q=nothing at all' })
    expect(await screen.findByText('No matching music yet')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Top result' })).not.toBeInTheDocument()
  })

  it('says so plainly when every result is a coincidental match', async () => {
    // Verbatim rows the live API returns for this query — none is Sara Al Sawas.
    server.use(
      http.get(`${AUDIUS_BASE}/v1/search/full`, () =>
        HttpResponse.json(
          catalogSearchResponse(
            [
              makeRawTrack({ id: 'n1', title: 'PARAS - LOWAS GV RMX' }),
              makeRawTrack({ id: 'n2', title: 'carwash (die by the sword) - bladee' }),
              makeRawTrack({ id: 'n3', title: 'Radio Wasteland - Paranormal Oddities' }),
            ],
            [],
          ),
        ),
      ),
    )
    renderApp({ route: '/search?q=sara al swas' })

    expect(await screen.findByText('No strong matches found.')).toBeInTheDocument()
    // Nothing unrelated is promoted as the top result.
    expect(screen.queryByRole('heading', { name: 'Top result' })).not.toBeInTheDocument()
    expect(screen.queryByText('PARAS - LOWAS GV RMX')).not.toBeInTheDocument()
    // And it is worded differently from "the catalogue returned nothing".
    expect(screen.queryByText('No matching music yet')).not.toBeInTheDocument()
  })

  it('distinguishes an empty catalogue response from a low-relevance one', async () => {
    renderApp({ route: '/search?q=nothing at all' })
    expect(await screen.findByText('No matching music yet')).toBeInTheDocument()
    expect(screen.queryByText('No strong matches found.')).not.toBeInTheDocument()
  })

  // Phase 2: the error state is reserved for *every* catalogue being down. One
  // provider failing while another answers is a partial success, and is covered
  // by MultiProviderSearchPage.test.tsx.
  it('shows a retryable error state when every provider fails', async () => {
    server.use(errorHandlers.catalogServerError, jamendoHandlers.serverError())
    renderApp({ route: '/search?q=midnight' })

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Search is unavailable')).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('surfaces a rate-limit message distinct from a generic failure', async () => {
    server.use(errorHandlers.catalogRateLimited, jamendoHandlers.serverError())
    renderApp({ route: '/search?q=midnight' })
    expect(await screen.findByText(/Too many requests/i)).toBeInTheDocument()
  })

  it('recovers when the retry button succeeds', async () => {
    server.use(errorHandlers.catalogServerError, jamendoHandlers.serverError())
    const { user } = renderApp({ route: '/search?q=midnight' })

    const retry = await screen.findByRole('button', { name: 'Try again' })
    server.resetHandlers()
    await user.click(retry)

    expect(await screen.findByRole('heading', { level: 3, name: 'Midnight Signal' })).toBeInTheDocument()
  })

  it('does not query the provider for a bare /search route', async () => {
    let called = false
    server.use(
      http.get(`${AUDIUS_BASE}/v1/search/full`, () => {
        called = true
        return HttpResponse.json(catalogSearchResponse())
      }),
    )
    renderApp({ route: '/search' })
    expect(await screen.findByText('Start typing to search')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('marks a gated track as unavailable and disables its row', async () => {
    renderApp({ route: '/search?q=Gated' })
    const row = await screen.findByRole('button', {
      name: /Gated Premiere by The Vault is not available to stream/i,
    })
    expect(row).toBeDisabled()
    expect(within(rowFor(row)).getByText('Gated')).toBeInTheDocument()
  })

  it('renders provider text as text, never as HTML', async () => {
    const title = '<img src=x onerror="alert(1)">'
    server.use(
      http.get(`${AUDIUS_BASE}/v1/search/full`, () =>
        HttpResponse.json(
          catalogSearchResponse(
            [
              {
                id: 'xss1',
                title,
                duration: 100,
                followee_reposts: [],
                followee_favorites: [],
                track_segments: [],
                remix_of: null,
                user: { id: 'u', name: 'Safe', handle: 'safe' },
              },
            ],
            [],
          ),
        ),
      ),
    )
    // Query the literal title so the relevance layer keeps the row.
    const { container } = renderApp({ route: `/search?q=${encodeURIComponent(title)}` })
    expect(await screen.findAllByText(title)).not.toHaveLength(0)
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })

  it('gives every result row a unique React key (no duplicate-key warning)', async () => {
    server.use(
      http.get(`${AUDIUS_BASE}/v1/search/full`, () =>
        HttpResponse.json(catalogSearchResponse([...RAW_TRACKS, ...RAW_TRACKS], [])),
      ),
    )
    renderApp({ route: '/search?q=midnight' })
    const buttons = await screen.findAllByRole('button', { name: /Midnight Signal/i })
    // The top-result card plus exactly one list row — the duplicate was dropped.
    expect(buttons.filter((b) => b.classList.contains('song-row-action'))).toHaveLength(1)
  })
})
