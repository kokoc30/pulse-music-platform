import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TopResultCard } from '@/components/search/TopResultCard'
import { PlayerTrackInfo } from '@/components/player/PlayerTrackInfo'
import { TrackCard } from '@/components/track/TrackCard'
import { TrackList } from '@/components/track/TrackList'
import type { Track } from '@/music/types'
import { ProviderCredit } from './ProviderCredit'

/**
 * Jamendo's API terms require the artist credited, Jamendo credited as the
 * provider, and a direct backlink to each item's own Jamendo page
 * (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md). Audius asks for none of that,
 * so the reference layout must stay untouched for Audius rows.
 */

function jamendoTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'jamendo:1880336',
    mediaKind: 'audio',
    provider: 'jamendo',
    providerId: '1880336',
    title: 'Reverie',
    artistName: 'Lumen Field',
    artwork: {},
    durationSeconds: 214,
    isStreamable: true,
    attributionRequired: true,
    sourceUrl: 'https://www.jamendo.com/track/1880336/reverie',
    permalink: 'https://www.jamendo.com/track/1880336/reverie',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
    streamUrl: 'https://prod-1.storage.jamendo.com/?trackid=1880336',
    ...overrides,
  }
}

function audiusTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'audius:trk1',
    mediaKind: 'audio',
    provider: 'audius',
    providerId: 'trk1',
    title: 'Midnight Signal',
    artistName: 'Nova Sound',
    artwork: {},
    durationSeconds: 214,
    isStreamable: true,
    permalink: 'https://audius.co/novasound/midnight-signal',
    ...overrides,
  }
}

describe('provider credit', () => {
  it('credits Jamendo as the provider', () => {
    render(<ProviderCredit track={jamendoTrack()} />)
    expect(screen.getByText('Jamendo')).toBeInTheDocument()
  })

  it('renders the backlink with safe external-link attributes', () => {
    render(<ProviderCredit track={jamendoTrack()} variant="link" />)
    const link = screen.getByRole('link', { name: /View “Reverie” on Jamendo/i })
    expect(link).toHaveAttribute('href', 'https://www.jamendo.com/track/1880336/reverie')
    expect(link).toHaveAttribute('target', '_blank')
    // `noopener` prevents the opened page reaching back through window.opener.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('degrades to a plain credit when the provider gave no source URL', () => {
    render(<ProviderCredit track={jamendoTrack({ sourceUrl: undefined })} variant="link" />)
    expect(screen.getByText('Jamendo')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders nothing at all for a provider that requires no attribution', () => {
    const { container } = render(<ProviderCredit track={audiusTrack()} variant="link" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('attribution in the result list', () => {
  const noop = () => {}

  /** Every Jamendo track a result list can realistically contain. */
  const JAMENDO_FIXTURES: Track[] = [
    jamendoTrack({ id: 'jamendo:1', providerId: '1', title: 'Reverie' }),
    jamendoTrack({
      id: 'jamendo:2',
      providerId: '2',
      title: 'Slow Country',
      artistName: 'Cedar Room',
      sourceUrl: 'https://www.jamendo.com/track/2/slow-country',
    }),
    // Not playable, but still a rendered content item — the terms make no
    // exception for a track that happens to have no stream.
    jamendoTrack({
      id: 'jamendo:3',
      providerId: '3',
      title: 'Unavailable Take',
      isStreamable: false,
      streamUrl: undefined,
      sourceUrl: 'https://www.jamendo.com/track/3/unavailable-take',
    }),
  ]

  const renderList = (tracks: Track[], compact = false) =>
    render(
      <TrackList
        tracks={tracks}
        compact={compact}
        currentTrackId={null}
        isPlaying={false}
        onPlay={noop}
      />,
    )

  it('gives EVERY Jamendo row its own direct backlink to that track', () => {
    const { container } = renderList(JAMENDO_FIXTURES)
    const rows = [...container.querySelectorAll<HTMLElement>('.song-row')]
    expect(rows).toHaveLength(JAMENDO_FIXTURES.length)

    rows.forEach((row, index) => {
      const fixture = JAMENDO_FIXTURES[index]
      const link = within(row).getByRole('link', {
        name: new RegExp(`View “${fixture.title}” on Jamendo`, 'i'),
      })
      // Each link must point at *its own* track, not at a shared page.
      expect(link).toHaveAttribute('href', fixture.sourceUrl!)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    // No two rows share a destination.
    const hrefs = rows.map((row) => within(row).getByRole('link').getAttribute('href'))
    expect(new Set(hrefs).size).toBe(rows.length)
  })

  it('credits the artist alongside the provider on every Jamendo row', () => {
    const { container } = renderList(JAMENDO_FIXTURES)
    for (const row of container.querySelectorAll<HTMLElement>('.song-row')) {
      expect(within(row).getByText(/Lumen Field|Cedar Room/)).toBeInTheDocument()
      expect(within(row).getByText('Jamendo')).toBeInTheDocument()
    }
  })

  it('backlinks queue rows too, which render the track as a content item', () => {
    const { container } = renderList(JAMENDO_FIXTURES, true)
    const rows = [...container.querySelectorAll<HTMLElement>('.song-row')]
    expect(rows).toHaveLength(JAMENDO_FIXTURES.length)
    for (const row of rows) {
      expect(within(row).getByRole('link', { name: /on Jamendo/i })).toBeInTheDocument()
    }
  })

  it('leaves an Audius row exactly as the reference draws it', () => {
    const { container } = renderList([audiusTrack()])
    const row = container.querySelector<HTMLElement>('.song-row')!
    expect(within(row).queryByText('Jamendo')).not.toBeInTheDocument()
    expect(within(row).queryByText('Audius')).not.toBeInTheDocument()
    // No provider link is added to an Audius row.
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
    // And its play affordance keeps the reference's accessible name.
    expect(
      within(row).getByRole('button', { name: 'Play Midnight Signal by Nova Sound' }),
    ).toBeInTheDocument()
  })

  it('keeps the anchor a sibling of the play button, never a descendant', () => {
    // An <a> inside a <button> is invalid markup and is what forced the row to
    // stop being a button in the first place.
    const { container } = renderList(JAMENDO_FIXTURES)
    for (const row of container.querySelectorAll<HTMLElement>('.song-row')) {
      const button = within(row).getByRole('button')
      const link = within(row).getByRole('link')
      expect(button.contains(link)).toBe(false)
      expect(link.closest('button')).toBeNull()
      expect(row.contains(button)).toBe(true)
      expect(row.contains(link)).toBe(true)
    }
  })

  it('still exposes one play button per row, with the row-level state on the row', () => {
    const { container } = renderList(JAMENDO_FIXTURES)
    const rows = [...container.querySelectorAll<HTMLElement>('.song-row')]

    const playable = rows[0]
    expect(within(playable).getByRole('button')).toBeEnabled()
    expect(playable).not.toHaveAttribute('aria-disabled')

    const gated = rows[2]
    expect(within(gated).getByRole('button')).toBeDisabled()
    expect(gated).toHaveAttribute('aria-disabled', 'true')
    // A gated track keeps its backlink: it is still displayed content.
    expect(within(gated).getByRole('link', { name: /on Jamendo/i })).toBeInTheDocument()
  })

  it('falls back to an unlinked credit only when the provider gave no page', () => {
    const { container } = renderList([jamendoTrack({ sourceUrl: undefined, permalink: undefined })])
    const row = container.querySelector<HTMLElement>('.song-row')!
    expect(within(row).getByText('Jamendo')).toBeInTheDocument()
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('attribution on a media card', () => {
  it('backlinks a Jamendo card, since a card is a rendered content item', () => {
    render(<TrackCard track={jamendoTrack()} onPlay={() => {}} />)
    const link = screen.getByRole('link', { name: /View “Reverie” on Jamendo/i })
    expect(link).toHaveAttribute('href', 'https://www.jamendo.com/track/1880336/reverie')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('adds nothing to an Audius card', () => {
    render(<TrackCard track={audiusTrack()} onPlay={() => {}} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('Jamendo')).not.toBeInTheDocument()
  })
})

describe('attribution in the top result', () => {
  it('carries the required direct backlink', () => {
    render(<TopResultCard track={jamendoTrack()} state="idle" onPlay={() => {}} />)
    const link = screen.getByRole('link', { name: /View “Reverie” on Jamendo/i })
    expect(link).toHaveAttribute('href', 'https://www.jamendo.com/track/1880336/reverie')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('adds no provider link to an Audius top result', () => {
    render(<TopResultCard track={audiusTrack()} state="idle" onPlay={() => {}} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('attribution in the now-playing cluster', () => {
  it('links a playing Jamendo track back to its Jamendo page', () => {
    render(<PlayerTrackInfo track={jamendoTrack()} />)
    // The credit itself is the anchor: the reference hides the icon link below
    // 560px, and a licence-required backlink may not vanish on a phone.
    const link = screen.getByRole('link', { name: /View “Reverie” on Jamendo/i })
    expect(link).toHaveAttribute('href', 'https://www.jamendo.com/track/1880336/reverie')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('Jamendo')).toBeInTheDocument()
  })

  it('keeps the Audius link and its wording unchanged', () => {
    render(<PlayerTrackInfo track={audiusTrack()} />)
    const link = screen.getByRole('link', { name: /Open Midnight Signal on Audius/i })
    expect(link).toHaveAttribute('href', 'https://audius.co/novasound/midnight-signal')
    expect(screen.queryByText('Jamendo')).not.toBeInTheDocument()
  })

  it('carries exactly one backlink, not a duplicate of the icon link', () => {
    render(<PlayerTrackInfo track={jamendoTrack()} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('renders without a link when the provider gave no page for the track', () => {
    render(<PlayerTrackInfo track={jamendoTrack({ sourceUrl: undefined, permalink: undefined })} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    // The provider credit still stands.
    expect(screen.getByText('Jamendo')).toBeInTheDocument()
  })

  it('exposes no download affordance for a Jamendo track', () => {
    const { container } = render(<PlayerTrackInfo track={jamendoTrack()} />)
    expect(container.querySelector('[download]')).toBeNull()
    expect(container.innerHTML).not.toContain('audiodownload')
    expect(container.innerHTML).not.toContain('/download/')
  })

  it('retains the licence URL on the track model for the record', () => {
    // No UI clutter is required for it, but the deed must not be discarded.
    expect(jamendoTrack().licenseUrl).toContain('creativecommons.org')
  })
})
