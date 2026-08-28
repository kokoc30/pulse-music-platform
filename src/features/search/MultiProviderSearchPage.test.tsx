import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { errorHandlers, jamendoHandlers } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'
import { makeJamendoTrack } from '@/test/fixtures/jamendo'
import { renderApp, trackRows } from '@/test/render'

/**
 * The search page driven through the real hook, the real aggregator and the
 * real `/api/jamendo` wire contract — only the network is doubled.
 *
 * These are the "one application, not two provider tabs" assertions
 * (agents/15_MULTI_PROVIDER_SEARCH.md → "Search Result Presentation").
 */

const rows = () => trackRows()

describe('unified multi-provider search', () => {
  it('shows results from both catalogues in one list, with no provider tabs', async () => {
    server.use(
      jamendoHandlers.withResults([
        makeJamendoTrack({ id: 'j1', title: 'Midnight Signal Reprise', artistName: 'Lumen Field' }),
      ]),
    )
    renderApp({ route: '/search?q=midnight' })

    // The Audius fixture catalogue contains "Midnight Signal".
    expect(await screen.findByRole('heading', { name: /Results for “midnight”/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('Midnight Signal Reprise').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Midnight Signal').length).toBeGreaterThan(0)

    // One list, one "Songs" heading — the reference layout is unchanged.
    expect(screen.getAllByRole('heading', { name: 'Songs' })).toHaveLength(1)
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Jamendo$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Audius$/ })).not.toBeInTheDocument()
  })

  it('credits Jamendo on its own rows and leaves Audius rows alone', async () => {
    server.use(
      jamendoHandlers.withResults([
        makeJamendoTrack({ id: 'j1', title: 'Midnight Signal Reprise', artistName: 'Lumen Field' }),
      ]),
    )
    renderApp({ route: '/search?q=midnight' })

    await waitFor(() => expect(screen.getAllByText('Midnight Signal Reprise').length).toBeGreaterThan(0))

    const jamendoRow = rows().find((row) => within(row).queryByText('Midnight Signal Reprise'))
    expect(jamendoRow).toBeDefined()
    expect(within(jamendoRow!).getByText('Jamendo')).toBeInTheDocument()

    const audiusRow = rows().find((row) => within(row).queryByText('Midnight Signal'))
    expect(within(audiusRow!).queryByText('Jamendo')).not.toBeInTheDocument()
  })

  it('keeps working, with no visible error, when Jamendo is not configured', async () => {
    server.use(jamendoHandlers.unavailable())
    renderApp({ route: '/search?q=midnight' })

    await waitFor(() => expect(screen.getAllByText('Midnight Signal').length).toBeGreaterThan(0))
    // A deployment without JAMENDO_CLIENT_ID must look completely normal.
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/JAMENDO_CLIENT_ID/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Search is unavailable/ })).not.toBeInTheDocument()
  })

  it('keeps working when Jamendo is configured but failing', async () => {
    server.use(jamendoHandlers.serverError())
    renderApp({ route: '/search?q=midnight' })

    await waitFor(() => expect(screen.getAllByText('Midnight Signal').length).toBeGreaterThan(0))
    expect(screen.queryByRole('heading', { name: /Search is unavailable/ })).not.toBeInTheDocument()
  })

  it('falls back to Jamendo alone when Audius is down', async () => {
    server.use(
      errorHandlers.catalogServerError,
      jamendoHandlers.withResults([
        makeJamendoTrack({ id: 'j1', title: 'Midnight Signal Reprise', artistName: 'Lumen Field' }),
      ]),
    )
    renderApp({ route: '/search?q=midnight' })

    await waitFor(() => expect(screen.getAllByText('Midnight Signal Reprise').length).toBeGreaterThan(0))
    expect(screen.queryByRole('heading', { name: /Search is unavailable/ })).not.toBeInTheDocument()
  })

  it('shows the existing error state only when both catalogues are down', async () => {
    server.use(errorHandlers.catalogServerError, jamendoHandlers.serverError())
    renderApp({ route: '/search?q=midnight' })

    expect(await screen.findByRole('heading', { name: /Search is unavailable/ })).toBeInTheDocument()
  })

  it('shows a Jamendo row that has no stream as unavailable rather than hiding it', async () => {
    server.use(
      jamendoHandlers.withResults([
        makeJamendoTrack({ id: 'j3', title: 'Midnight Signal Take Two', audioUrl: undefined }),
      ]),
    )
    renderApp({ route: '/search?q=midnight' })

    const row = await screen.findByRole('button', { name: /Midnight Signal Take Two.*not available to stream/i })
    expect(row).toBeDisabled()
  })

  it('gives every merged row a unique React key across both providers', async () => {
    // Both catalogues genuinely use `trk1`-style ids; only the namespace keeps
    // them apart.
    server.use(
      jamendoHandlers.withResults([
        makeJamendoTrack({ id: 'trk1', title: 'Midnight Signal Reprise', artistName: 'Lumen Field' }),
      ]),
    )
    const warnings: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      warnings.push(args)
      original(...args)
    }
    try {
      renderApp({ route: '/search?q=midnight' })
      await waitFor(() => expect(screen.getAllByText('Midnight Signal Reprise').length).toBeGreaterThan(0))
    } finally {
      console.error = original
    }
    const duplicateKeyWarning = warnings.filter((entry) => String(entry[0]).includes('same key'))
    expect(duplicateKeyWarning).toEqual([])
  })
})
