import { useEffect, useMemo, useState } from 'react'
import { Heart, Play, Search, Shuffle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/feedback/EmptyState'
import { LibraryTrackRow } from '@/components/library/LibraryTrackRow'
import { PlaylistCover } from '@/components/library/PlaylistCover'
import { useCoverArt, useLikedTracks } from '@/library/hooks'
import { playPlaylist } from '@/library/library-actions'
import { LIKED_SORT_LABELS, filterTrackRefs } from '@/library/selectors'
import type { LikedSort } from '@/library/selectors'
import { useCurrentTrack, useIsPlaying } from '@/player/player-selectors'
import { usePlayerStore } from '@/player/player-store'
import { useYouTubeStore } from '@/player/youtube-store'

const CONTEXT = { id: 'library:liked', label: 'Liked Songs' }

/**
 * Liked Songs.
 *
 * A system collection rather than a playlist: there is no rename control and no
 * delete control anywhere on this page, because there is no playlist record
 * behind it to rename or delete — only a membership list (agents/41 → "Liked
 * Songs"). The heart on each row is the only way in and the only way out.
 */
export function LikedSongsPage() {
  const [sort, setSort] = useState<LikedSort>('recent')
  const [query, setQuery] = useState('')
  const liked = useLikedTracks(sort)
  const cover = useCoverArt(liked)
  const currentTrack = useCurrentTrack()
  const isPlaying = useIsPlaying()
  const youtubeItem = useYouTubeStore((store) => store.item)
  const setShuffle = usePlayerStore((store) => store.setShuffle)

  useEffect(() => {
    document.title = 'Liked Songs — Pulse'
    return () => {
      document.title = 'Pulse — Music Discovery'
    }
  }, [])

  const rows = useMemo(() => filterTrackRefs(liked, query), [liked, query])
  const currentKey = youtubeItem?.id ?? currentTrack?.id ?? null

  const play = (index: number) => void playPlaylist(rows, index, CONTEXT)

  return (
    <section className="search-results library-detail">
      <header className="library-hero">
        <PlaylistCover cover={cover} variant="liked" />
        <div>
          <p className="eyebrow">Saved in Pulse on this device</p>
          <h1>Liked Songs</h1>
          <p className="library-hero-meta">
            {liked.length === 0
              ? 'Nothing yet'
              : `${liked.length} ${liked.length === 1 ? 'song' : 'songs'}`}
          </p>
          <div className="library-hero-actions">
            <button
              type="button"
              className="library-play"
              disabled={rows.length === 0}
              onClick={() => {
                setShuffle(false)
                play(0)
              }}
            >
              <Play size={16} fill="currentColor" aria-hidden="true" /> Play
            </button>
            <button
              type="button"
              className="library-shuffle"
              disabled={rows.length === 0}
              onClick={() => {
                // Shuffle is a running order over the queue, so it is switched on
                // before the queue is built and never rewrites what is stored.
                setShuffle(true)
                play(0)
              }}
            >
              <Shuffle size={16} aria-hidden="true" /> Shuffle
            </button>
          </div>
        </div>
      </header>

      {liked.length > 0 ? (
        <div className="library-toolbar">
          <div className="library-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find in Liked Songs"
              aria-label="Find in Liked Songs"
            />
          </div>
          <label className="library-sort">
            <span>Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as LikedSort)}
              aria-label="Sort Liked Songs"
            >
              {(Object.keys(LIKED_SORT_LABELS) as LikedSort[]).map((option) => (
                <option key={option} value={option}>
                  {LIKED_SORT_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="song-list" data-testid="liked-list">
          {rows.map((trackRef, index) => (
            <LibraryTrackRow
              key={trackRef.key}
              trackRef={trackRef}
              index={index}
              isCurrent={currentKey === trackRef.key}
              isPlaying={isPlaying}
              onPlay={() => play(index)}
            />
          ))}
        </div>
      ) : liked.length > 0 ? (
        <EmptyState
          icon={<Search size={32} aria-hidden="true" />}
          title="Nothing matches that"
          description="This searches only what is saved on this device."
        />
      ) : (
        <EmptyState
          icon={<Heart size={32} aria-hidden="true" />}
          title="Songs you like will appear here."
          description="Press the heart on any track in Search, Home or Recently played to save it in Pulse."
        />
      )}

      <p className="library-footnote">
        <Link to="/library">Back to Your Library</Link>
      </p>
    </section>
  )
}
