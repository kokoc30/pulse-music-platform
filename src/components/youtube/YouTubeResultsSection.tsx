import { Youtube } from 'lucide-react'
import { playYouTubeVideo } from '@/player/youtube-actions'
import { useYouTubeStore } from '@/player/youtube-store'
import type { YouTubeVideoItem } from '@/music/types'
import type { YouTubeFallbackState } from '@/features/search/useYouTubeFallback'
import { YouTubeResultRow } from './YouTubeResultRow'

interface YouTubeResultsSectionProps {
  fallback: YouTubeFallbackState
}

/**
 * The separately-labelled "YouTube results" block.
 *
 * It is never merged into `Songs`. YouTube results are video, they play in a
 * different player, and several of them may not be playable in this app at all —
 * folding them into the audio list would misrepresent all three facts
 * (agents/25 → "Results Section").
 *
 * The icon is `lucide-react`'s generic media glyph used as a *section marker*,
 * not as a YouTube brand mark: attribution is carried by the word "YouTube" in
 * the heading and on every row, because the branding guidelines forbid a
 * modified or re-coloured logo and this build ships none of the official assets
 * (docs/youtube-policy-audit.md §10).
 */
export function YouTubeResultsSection({ fallback }: YouTubeResultsSectionProps) {
  const activeItem = useYouTubeStore((state) => state.item)
  const status = useYouTubeStore((state) => state.status)

  if (fallback.status === 'idle') return null

  const play = (item: YouTubeVideoItem) => {
    // A real click: user-initiated, so playback may start once the surface is
    // on screen. `playYouTubeVideo` opens the surface before it asks to play.
    void playYouTubeVideo(item, { userInitiated: true })
  }

  return (
    <section className="yt-results" aria-labelledby="youtube-results-heading">
      <h2 className="result-label yt-results-heading" id="youtube-results-heading">
        <Youtube size={18} aria-hidden="true" /> YouTube results
      </h2>
      <p className="yt-results-note">
        Video results from YouTube, played in YouTube&rsquo;s own player. Audius and Jamendo tracks
        above play in the Pulse audio player.
      </p>

      {fallback.status === 'loading' ? (
        <div className="yt-list" aria-busy="true" data-testid="youtube-loading">
          {[0, 1, 2].map((index) => (
            <div className="yt-row is-skeleton" key={index} aria-hidden="true">
              <span className="skeleton" style={{ width: 80, height: 45, borderRadius: 4 }} />
              <div className="yt-row-data">
                <span className="skeleton skeleton-line" style={{ width: '52%', height: 15 }} />
                <span className="skeleton skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      ) : fallback.status === 'quota' ? (
        <p className="yt-results-error" role="alert">
          YouTube search is temporarily unavailable. Try again later.
        </p>
      ) : fallback.status === 'unavailable' ? (
        <p className="yt-results-error" role="alert">
          YouTube search is not available on this deployment.
        </p>
      ) : fallback.status === 'error' ? (
        <p className="yt-results-error" role="alert">
          YouTube search had a problem. Audius and Jamendo results are unaffected.
        </p>
      ) : fallback.videos.length === 0 ? (
        <p className="yt-results-note">No YouTube videos matched this search either.</p>
      ) : (
        <div className="yt-list" data-testid="youtube-results">
          {fallback.videos.map((item) => (
            <YouTubeResultRow
              key={item.id}
              item={item}
              isCurrent={activeItem?.id === item.id}
              isPlaying={activeItem?.id === item.id && status === 'playing'}
              onPlay={() => play(item)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
