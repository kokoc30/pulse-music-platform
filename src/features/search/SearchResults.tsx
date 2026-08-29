import { Search, SearchX, X, Youtube } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { TrackListSkeleton } from '@/components/feedback/TrackListSkeleton'
import { TopResultCard } from '@/components/search/TopResultCard'
import { TrackList } from '@/components/track/TrackList'
import { YouTubeFallbackAction } from '@/components/youtube/YouTubeFallbackAction'
import { YouTubeResultsSection } from '@/components/youtube/YouTubeResultsSection'
import { playSeedTrack } from '@/features/discovery/playShelf'
import type { Track } from '@/music/types'
import { useCurrentTrack, useIsLoading, useIsPlaying } from '@/player/player-selectors'
import type { TrackSearchState } from './useTrackSearch'
import { useSearchHistory } from './useSearchHistory'
import { useSubmittedSearchKey } from './useSubmittedSearch'
import { useYouTubeFallback } from './useYouTubeFallback'

interface SearchResultsProps {
  query: string
  search: TrackSearchState
}

/** The reference's `.search-results` panel, driven by real Audius results. */
export function SearchResults({ query, search }: SearchResultsProps) {
  const navigate = useNavigate()
  const currentTrack = useCurrentTrack()
  const isPlaying = useIsPlaying()
  const isLoading = useIsLoading()
  const { status, tracks, outcome, error, retry, hasStrongOpenCatalogMatch } = search

  /**
   * The YouTube fallback.
   *
   * Declaring the hook still does nothing on its own — it holds no effect that
   * fetches on `query`, so typing and simply being on this page cost no quota
   * (agents/22 → "Quota Constraint").
   *
   * A search is spent in exactly two situations:
   *
   * · `fallback.run` — the manual buttons below;
   * · an **explicit submission** (Enter, a genre link, an artist card — anything
   *   that pushes history) whose open-catalog search settled with no strong
   *   match. `submissionKey` is `null` for search-as-you-type and for deep
   *   links, so neither can ever reach this path.
   */
  const submissionKey = useSubmittedSearchKey()
  const catalogsSettled = status === 'success'
  const noStrongOpenCatalogMatch = catalogsSettled && !hasStrongOpenCatalogMatch

  // The first-party record of what the visitor actually asked for. Typing never
  // reaches it — only a real submission does (STEP 6).
  useSearchHistory(query, submissionKey, search)

  const fallback = useYouTubeFallback(query, {
    submissionKey,
    autoRunWhen: noStrongOpenCatalogMatch,
  })
  const fallbackLoading = fallback.status === 'loading'

  /**
   * The automatic search is decided in an effect, so there is one render
   * between "the catalogues came back empty" and "the request is in flight".
   * Counting that render as searching is what stops the final *No strong
   * matches found* screen from flashing up as though the whole search had
   * failed before YouTube has even been asked.
   */
  const autoFallbackPending =
    noStrongOpenCatalogMatch && Boolean(submissionKey) && fallback.status === 'idle'
  const searchingYouTube = fallbackLoading || autoFallbackPending

  /**
   * Once YouTube has actually found something, the open-catalog empty state
   * stops being the truth: the search did not fail, it was answered elsewhere.
   * Leaving a large *No strong matches found.* headline sitting above eight
   * real results would contradict the page. The YouTube section carries its own
   * heading and explanation, so it can speak for itself.
   */
  const foundOnYouTube = fallback.videos.length > 0

  const context = { id: `search:${query}`, label: `“${query}”` }

  /**
   * A search row is a *seed*, not a collection.
   *
   * Clicking one result means "play this song", so the queue becomes that one
   * track and Phase 6 autoplay chooses what follows. Previously the whole result
   * list became the explicit queue, which meant the next thing to play was
   * always the next search row — often another upload of the same recording —
   * and the similarity planner was never consulted at all
   * (docs/SEARCH_SEED_AND_YOUTUBE_CONTINUATION_FIX.md).
   *
   * The other results stay on the page; they are simply not queued on the
   * visitor's behalf.
   */
  const play = (index: number) => {
    const track = tracks[index]
    if (track) void playSeedTrack(track, context)
  }

  const topResult: Track | undefined = tracks[0]
  const topState: 'idle' | 'loading' | 'playing' =
    topResult && currentTrack?.id === topResult.id
      ? isLoading
        ? 'loading'
        : isPlaying
          ? 'playing'
          : 'idle'
      : 'idle'

  // The fallback is offered once the catalogues have actually answered — never
  // while they are still loading, and never on a provider error, where the
  // honest action is to retry the search rather than change catalogue.
  const canOfferFallback = status === 'success'

  return (
    <section className="search-results" aria-live="polite" aria-busy={status === 'loading'}>
      <div className="result-title-row">
        <div>
          <p className="eyebrow">Search results</p>
          <h1>Results for “{query}”</h1>
        </div>
        <button type="button" className="clear-search" onClick={() => void navigate('/')}>
          <X size={17} aria-hidden="true" /> Clear
        </button>
      </div>

      {status === 'loading' ? (
        <>
          <h2 className="result-label">Top result</h2>
          <div className="top-result-card" aria-hidden="true">
            <span className="skeleton" style={{ width: 92, height: 92, borderRadius: 4 }} />
            <div>
              <span className="skeleton skeleton-line" style={{ width: '55%', height: 18 }} />
              <span className="skeleton skeleton-line short" />
            </div>
          </div>
          <h2 className="result-label songs-heading">Songs</h2>
          <TrackListSkeleton />
        </>
      ) : status === 'error' && error ? (
        <ErrorState
          title="Search is unavailable"
          message={error.message}
          onRetry={error.code === 'ABORTED' ? undefined : retry}
        />
      ) : hasStrongOpenCatalogMatch && tracks.length && topResult ? (
        <>
          <h2 className="result-label">Top result</h2>
          <TopResultCard track={topResult} state={topState} onPlay={() => play(0)} />
          <h2 className="result-label songs-heading">Songs</h2>
          <TrackList
            tracks={tracks}
            currentTrackId={currentTrack?.id ?? null}
            isPlaying={isPlaying}
            onPlay={(_track, index) => play(index)}
          />
          {/* The subtle variant: the catalogues answered well, and a visitor
              looking for an international or mainstream release can still ask
              for YouTube — but only by asking. */}
          {canOfferFallback && fallback.status === 'idle' ? (
            <div className="yt-fallback-more-row">
              <YouTubeFallbackAction onRun={fallback.run} loading={false} variant="more" />
            </div>
          ) : null}
        </>
      ) : searchingYouTube ? (
        // Neither failure state is the truth yet: the open catalogues had
        // nothing, and YouTube has not answered.
        <EmptyState
          icon={<Youtube size={32} aria-hidden="true" />}
          title="Searching YouTube…"
          description="Nothing in the Audius or Jamendo catalogues strongly matched this search, so Pulse is checking YouTube for it."
        />
      ) : foundOnYouTube ? null : outcome === 'no-strong-match' ? (
        // The catalogues answered, but every row they returned was a
        // coincidental substring match. Saying so is more useful than promoting
        // one of them. Deliberately provider-neutral: the visitor searches once
        // and never learns which catalogue answered
        // (agents/15_MULTI_PROVIDER_SEARCH.md → "Search Result Presentation").
        <EmptyState
          icon={<SearchX size={32} aria-hidden="true" />}
          title="No strong matches found."
          description="Nothing in the Audius or Jamendo catalogues strongly matched this search — the rows they returned share only a word or two with it. YouTube covers far more international and mainstream music."
          action={
            canOfferFallback ? (
              <YouTubeFallbackAction
                onRun={fallback.run}
                loading={fallbackLoading}
                variant="prompt"
              />
            ) : undefined
          }
        />
      ) : (
        <EmptyState
          icon={<Search size={32} aria-hidden="true" />}
          title="No matching music yet"
          description="Nothing in the Audius or Jamendo catalogues matched this search. YouTube covers far more international and mainstream music."
          action={
            canOfferFallback ? (
              <YouTubeFallbackAction
                onRun={fallback.run}
                loading={fallbackLoading}
                variant="prompt"
              />
            ) : undefined
          }
        />
      )}

      <YouTubeResultsSection fallback={fallback} />
    </section>
  )
}
