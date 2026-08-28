import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderApp } from '@/test/render'

/**
 * The privacy disclosure agents/26 requires.
 *
 * The assertions check that each thing the code actually does is *stated* —
 * external providers, YouTube/Google receiving playback data, no autoplay on
 * load, the MadeForKids handling — and that the page links to Google's own
 * policy rather than paraphrasing it.
 */
describe('the privacy page', () => {
  it('is reachable from the footer', async () => {
    const { user } = renderApp({ route: '/' })
    const footer = await screen.findByRole('contentinfo')
    await user.click(within(footer).getByRole('link', { name: 'Privacy' }))
    expect(await screen.findByRole('heading', { name: 'Privacy', level: 1 })).toBeInTheDocument()
  })

  it('is a real, shareable URL', async () => {
    renderApp({ route: '/privacy' })
    expect(await screen.findByRole('heading', { name: 'Privacy', level: 1 })).toBeInTheDocument()
  })

  it('states that there is no account and no database', async () => {
    renderApp({ route: '/privacy' })
    expect(await screen.findByText(/no sign-up, no login and no user profiles/i)).toBeInTheDocument()
  })

  it('names all three external providers', async () => {
    renderApp({ route: '/privacy' })
    await screen.findByRole('heading', { name: 'Privacy', level: 1 })
    expect(screen.getAllByText(/Audius/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Jamendo/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/YouTube/).length).toBeGreaterThan(0)
  })

  it('says plainly that YouTube and Google may receive playback data', async () => {
    renderApp({ route: '/privacy' })
    expect(
      await screen.findByText(/YouTube and Google may receive your IP address/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/may set or read cookies/i)).toBeInTheDocument()
  })

  it('says nothing YouTube-related runs before the visitor asks', async () => {
    renderApp({ route: '/privacy' })
    expect(await screen.findByText(/No YouTube player is loaded when the site opens/i)).toBeInTheDocument()
    expect(screen.getByText(/Nothing is sent to YouTube while you type/i)).toBeInTheDocument()
  })

  it('explains the MadeForKids handling truthfully', async () => {
    renderApp({ route: '/privacy' })
    expect(await screen.findByText(/marked as made for kids, Pulse does not embed it/i)).toBeInTheDocument()
  })

  it('links to Googles own privacy policy rather than paraphrasing it', async () => {
    renderApp({ route: '/privacy' })
    const link = await screen.findByRole('link', { name: /Google privacy policy/i })
    expect(link).toHaveAttribute('href', 'https://policies.google.com/privacy')
  })

  it('makes no legal guarantee', async () => {
    renderApp({ route: '/privacy' })
    await screen.findByRole('heading', { name: 'Privacy', level: 1 })
    const text = document.body.textContent ?? ''
    // agents/26: "Do not write legal guarantees."
    expect(text).not.toMatch(/we guarantee|warrant that|fully compliant with (GDPR|COPPA)/i)
  })

  it('keeps the Referer intact on its outbound links', async () => {
    renderApp({ route: '/privacy' })
    await screen.findByRole('heading', { name: 'Privacy', level: 1 })
    for (const link of document.querySelectorAll<HTMLAnchorElement>('.prose a[target="_blank"]')) {
      expect(link.rel).toBe('noopener')
    }
  })
})
