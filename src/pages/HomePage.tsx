import { useNavigate } from 'react-router-dom'
import { showNotice } from '@/app/ui-store'
import { ShelfSkeleton } from '@/components/feedback/ShelfSkeleton'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { HistoryCard } from '@/components/personalization/HistoryCard'
import { PersonalizationPrompt } from '@/components/personalization/PersonalizationPrompt'
import { ArtistCard } from '@/components/track/ArtistCard'
import { ChartCard } from '@/components/track/ChartCard'
import { StationCard } from '@/components/track/StationCard'
import { TrackCard } from '@/components/track/TrackCard'
import { DiscoveryShelf } from '@/features/discovery/DiscoveryShelf'
import { playChart, playFromShelf } from '@/features/discovery/playShelf'
import { CHART_SHELF, SHELF_CARD_COUNT, STATION_SHELF } from '@/features/discovery/shelves'
import { useHomeDashboard } from '@/features/discovery/useHomeDashboard'
import { MixCard } from '@/features/library/MixCard'
import type { Track } from '@/music/types'
import { CONTEXT_IDS } from '@/personalization/play-context'
import { playHistoryEntry } from '@/personalization/replay'
import { HOME_SECTION_ANCHORS, HOME_SECTION_TITLES } from '@/personalization/selectors'
import type { HomeSectionId } from '@/personalization/selectors'
import type { ListenEntry } from '@/personalization/types'
import { useCurrentTrack, useIsLoading, useIsPlaying } from '@/player/player-selectors'
import { useYouTubeStore } from '@/player/youtube-store'

/**
 * The home page: the reference's `.browse-content`, five shelves and the footer.
 *
 * The *geometry* is fixed and the *content* is not. A brand-new browser gets
 * exactly the Phase 1–3 discovery page, unchanged. As local listening history
 * accumulates, personalized shelves take slots from discovery one at a time —
 * always five shelves above the footer, always the same grid, so the page never
 * grows, never empties and never rearranges itself into something unfamiliar
 * (STEP 9, STEP 23).
 *
 * Which five is decided by `planHomeSections`, from the profile plus what could
 * actually be filled. This component only renders the plan.
 */
export function HomePage() {
  const navigate = useNavigate()
  const dashboard = useHomeDashboard()
  const { discovery, mixes, recommended, recent, because, artistTracks, profile } = dashboard
  const { trending, month, artists, stations, status, errors, reload } = discovery

  const currentTrack = useCurrentTrack()
  const isPlaying = useIsPlaying()
  const isLoading = useIsLoading()
  const youtubeItem = useYouTubeStore((store) => store.item)
  const youtubeStatus = useYouTubeStore((store) => store.status)
  const shelfStatus = status === 'loading' ? 'loading' : 'ready'

  const cardState = (track: Track): 'idle' | 'loading' | 'playing' => {
    if (currentTrack?.id !== track.id) return 'idle'
    if (isLoading) return 'loading'
    return isPlaying ? 'playing' : 'idle'
  }

  /** Recently Played spans both engines, so its state reads from both stores. */
  const entryState = (entry: ListenEntry): 'idle' | 'loading' | 'playing' => {
    if (entry.provider === 'youtube') {
      if (youtubeItem?.id !== entry.id) return 'idle'
      if (youtubeStatus === 'loading') return 'loading'
      return youtubeStatus === 'playing' ? 'playing' : 'idle'
    }
    if (currentTrack?.id !== entry.id) return 'idle'
    if (isLoading) return 'loading'
    return isPlaying ? 'playing' : 'idle'
  }

  /** A mix card is 'playing' while any of its tracks is the loaded one. */
  const mixState = (tracks: Track[]): 'idle' | 'loading' | 'playing' => {
    if (!currentTrack || !tracks.some((track) => track.id === currentTrack.id)) return 'idle'
    if (isLoading) return 'loading'
    return isPlaying ? 'playing' : 'idle'
  }

  const play = (tracks: Track[], index: number, id: string, label: string) =>
    void playFromShelf(tracks, index, { id, label })

  const scrollToShelf = (anchor: string) => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const trackShelf = (
    id: HomeSectionId,
    tracks: Track[],
    contextId: string,
    options: {
      title?: string
      error?: string | undefined
      description?: string
      /**
       * *Not interested* is offered only where the shelf is a claim about this
       * visitor. Trending and charts are claims about the catalogue, so hiding a
       * row there would have nothing to act on (agents/43).
       */
      canHide?: boolean
    } = {},
  ) => {
    const title = options.title ?? HOME_SECTION_TITLES[id]
    return (
      <DiscoveryShelf
        key={id}
        id={id}
        title={title}
        anchor={HOME_SECTION_ANCHORS[id]}
        status={shelfStatus}
        error={options.error}
        onRetry={reload}
        onShowAll={() => scrollToShelf(HOME_SECTION_ANCHORS[id])}
        skeleton={<ShelfSkeleton />}
        description={options.description}
      >
        <div className="music-grid">
          {tracks.slice(0, SHELF_CARD_COUNT).map((track, index) => (
            <TrackCard
              key={track.id}
              track={track}
              state={cardState(track)}
              canHide={options.canHide === true}
              onPlay={() => play(tracks, index, contextId, title)}
            />
          ))}
        </div>
      </DiscoveryShelf>
    )
  }

  const renderSection = (id: HomeSectionId) => {
    switch (id) {
      case 'recommended':
        return trackShelf(
          'recommended',
          recommended.map((item) => item.track),
          CONTEXT_IDS.recommended,
          {
            // The disclosure STEP 17 asks for, at the point where it is relevant.
            description: 'Chosen on this device from what you have played and saved here.',
            canHide: true,
          },
        )

      case 'recent':
        return (
          <DiscoveryShelf
            key="recent"
            id="recent"
            title={HOME_SECTION_TITLES.recent}
            anchor={HOME_SECTION_ANCHORS.recent}
            status="ready"
            onShowAll={() => scrollToShelf(HOME_SECTION_ANCHORS.recent)}
            skeleton={<ShelfSkeleton />}
            description="Kept on this device only."
          >
            <div className="music-grid">
              {recent.map((entry) => (
                <HistoryCard
                  key={entry.id}
                  entry={entry}
                  state={entryState(entry)}
                  onPlay={() =>
                    void playHistoryEntry(entry, {
                      id: CONTEXT_IDS.recent,
                      label: HOME_SECTION_TITLES.recent,
                    })
                  }
                />
              ))}
            </div>
          </DiscoveryShelf>
        )

      case 'mixes':
        return (
          <DiscoveryShelf
            key="mixes"
            id="mixes"
            title={HOME_SECTION_TITLES.mixes}
            anchor={HOME_SECTION_ANCHORS.mixes}
            status="ready"
            onShowAll={() => scrollToShelf(HOME_SECTION_ANCHORS.mixes)}
            skeleton={<ShelfSkeleton />}
            description="Built on this device from what you play and save. Nothing is uploaded."
          >
            <div className="music-grid">
              {mixes.map((mix) => (
                <MixCard
                  key={mix.id}
                  mix={mix}
                  state={mixState(mix.tracks)}
                  onPlay={() => play(mix.tracks, 0, `mix:${mix.id}`, mix.title)}
                />
              ))}
            </div>
          </DiscoveryShelf>
        )

      case 'because':
        if (!because) return null
        return trackShelf('because', because.tracks, CONTEXT_IDS.because, {
          title: `${HOME_SECTION_TITLES.because} ${because.seed.name}`,
          canHide: true,
        })

      case 'artists':
        return trackShelf('artists', artistTracks, CONTEXT_IDS.artists, { canHide: true })

      case 'trending':
        return trackShelf('trending', trending, 'shelf:trending', { error: errors.trending })

      case 'month':
        return trackShelf('month', month, 'shelf:month', { error: errors.month })

      case 'popular-artists':
        return (
          <DiscoveryShelf
            key="popular-artists"
            id="artists"
            className="artists-section"
            title={HOME_SECTION_TITLES['popular-artists']}
            anchor={HOME_SECTION_ANCHORS['popular-artists']}
            status={shelfStatus}
            error={errors.artists}
            onRetry={reload}
            onShowAll={() => scrollToShelf(HOME_SECTION_ANCHORS['popular-artists'])}
            skeleton={<ShelfSkeleton circular />}
          >
            <div className="artist-grid">
              {artists.slice(0, SHELF_CARD_COUNT).map((artist) => (
                <ArtistCard
                  key={artist.id}
                  artist={artist}
                  onSelect={() => void navigate(`/search?q=${encodeURIComponent(artist.name)}`)}
                />
              ))}
            </div>
          </DiscoveryShelf>
        )

      case 'stations':
        return (
          <DiscoveryShelf
            key="stations"
            id="stations"
            title={HOME_SECTION_TITLES.stations}
            anchor={HOME_SECTION_ANCHORS.stations}
            status={shelfStatus}
            onShowAll={() => scrollToShelf(HOME_SECTION_ANCHORS.stations)}
            skeleton={<ShelfSkeleton />}
          >
            <div className="music-grid">
              {STATION_SHELF.map((station) => {
                const tracks = stations[station.id] ?? []
                return (
                  <StationCard
                    key={station.id}
                    station={station}
                    tracks={tracks}
                    onPlay={() => {
                      if (!tracks.length) {
                        showNotice(`${station.label} is unavailable right now.`)
                        return
                      }
                      play(tracks, 0, `station:${station.id}`, `${station.label} station`)
                    }}
                  />
                )
              })}
            </div>
          </DiscoveryShelf>
        )

      case 'charts':
        return (
          <DiscoveryShelf
            key="charts"
            id="charts"
            className="charts-section"
            title={HOME_SECTION_TITLES.charts}
            anchor={HOME_SECTION_ANCHORS.charts}
            status="ready"
            onShowAll={() => scrollToShelf(HOME_SECTION_ANCHORS.charts)}
            skeleton={<ShelfSkeleton />}
          >
            <div className="music-grid">
              {CHART_SHELF.map((chart) => (
                <ChartCard key={chart.id} chart={chart} onPlay={() => void playChart(chart)} />
              ))}
            </div>
          </DiscoveryShelf>
        )

      default:
        return null
    }
  }

  return (
    <div className="browse-content" data-profile-stage={profile.stage}>
      <PersonalizationPrompt />
      {dashboard.sections.map(renderSection)}
      <SiteFooter />
    </div>
  )
}
