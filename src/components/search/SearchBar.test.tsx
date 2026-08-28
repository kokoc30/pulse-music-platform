import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { AUDIUS_BASE } from '@/test/msw/handlers'
import { catalogSearchResponse } from '@/test/fixtures/audius'
import { server } from '@/test/msw/server'
import { renderApp } from '@/test/render'
import { SEARCH_DEBOUNCE_MS } from '@/hooks/useDebouncedValue'

function countSearchCalls() {
  const queries: string[] = []
  server.use(
    http.get(`${AUDIUS_BASE}/v1/search/full`, ({ request }) => {
      queries.push(new URL(request.url).searchParams.get('query') ?? '')
      return HttpResponse.json(catalogSearchResponse())
    }),
  )
  return queries
}

describe('search bar', () => {
  it('has an accessible name and the reference placeholder', async () => {
    renderApp()
    const input = await screen.findByLabelText('Search songs and artists')
    expect(input).toHaveAttribute('placeholder', 'What do you want to play?')
  })

  it('debounces so typing does not fire a request per keystroke', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const queries = countSearchCalls()
    const { user } = renderApp()

    const input = await screen.findByLabelText('Search songs and artists')
    await user.type(input, 'drake')
    expect(queries).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 50)
    await waitFor(() => expect(queries.length).toBeGreaterThan(0))
    expect(queries).toEqual(['drake'])
    vi.useRealTimers()
  })

  it('never queries a whitespace-only input', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const queries = countSearchCalls()
    const { user } = renderApp()

    await user.type(await screen.findByLabelText('Search songs and artists'), '    ')
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 100)

    expect(queries).toHaveLength(0)
    vi.useRealTimers()
  })

  it('navigates to /search with the trimmed query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = renderApp()

    await user.type(await screen.findByLabelText('Search songs and artists'), '  drake  ')
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 50)

    expect(await screen.findByRole('heading', { name: /Results for “drake”/ })).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('returns to the browse page when the field is cleared', async () => {
    const { user } = renderApp({ route: '/search?q=midnight' })
    await screen.findByRole('heading', { name: /Results for/ })

    await user.click(screen.getByRole('button', { name: /Clear/i }))

    expect(await screen.findByRole('heading', { name: 'Trending songs' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Results for/ })).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 120))
    expect(screen.queryByRole('heading', { name: /Results for/ })).not.toBeInTheDocument()
  })

  it('returns to browse from the Home link and clears the field', async () => {
    const { user } = renderApp({ route: '/search?q=midnight' })
    await screen.findByRole('heading', { name: /Results for/ })

    await user.click(screen.getByRole('link', { name: 'Home' }))

    expect(await screen.findByRole('heading', { name: 'Trending songs' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Search songs and artists')).toHaveValue(''))
    // …and stays there: a stale query must not bounce the visitor back.
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 120))
    expect(screen.getByRole('heading', { name: 'Trending songs' })).toBeInTheDocument()
  })

  it('returns to browse from the brand mark without bouncing back', async () => {
    const { user } = renderApp({ route: '/search?q=midnight' })
    await screen.findByRole('heading', { name: /Results for/ })

    await user.click(screen.getByRole('link', { name: 'Pulse home' }))

    expect(await screen.findByRole('heading', { name: 'Trending songs' })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 120))
    expect(screen.queryByRole('heading', { name: /Results for/ })).not.toBeInTheDocument()
  })

  it('mirrors a deep-linked query back into the input', async () => {
    renderApp({ route: '/search?q=paper' })
    await waitFor(() =>
      expect(screen.getByLabelText('Search songs and artists')).toHaveValue('paper'),
    )
  })

  it('focuses the field on the Ctrl/Cmd+K shortcut the reference only draws', async () => {
    const { user } = renderApp()
    const input = await screen.findByLabelText('Search songs and artists')
    expect(input).not.toHaveFocus()

    await user.keyboard('{Control>}k{/Control}')
    expect(input).toHaveFocus()
  })

  it('length-limits the query so an absurd paste cannot reach the provider', async () => {
    renderApp()
    expect(await screen.findByLabelText('Search songs and artists')).toHaveAttribute(
      'maxlength',
      '120',
    )
  })
})
