import { useEffect, useMemo, useState } from 'react'
import { Heart, ListMusic, Plus, Search } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PlaylistCover } from '@/components/library/PlaylistCover'
import { useCoverArt, useLibraryStatus, useLikedTracks, usePlaylistSummaries } from '@/library/hooks'
import { createPlaylistWithTrack, LIBRARY_ROUTES } from '@/library/library-actions'
import { filterPlaylistSummaries } from '@/library/selectors'
import { PLAYLIST_SORT_LABELS } from '@/library/selectors'
import type { PlaylistSort } from '@/library/selectors'
import { MAX_PLAYLIST_NAME_LENGTH } from '@/library/types'
import { HOME_SECTION_ANCHORS } from '@/personalization/selectors'

/**
 * Your Library.
 *
 * Two collections and nothing else: Liked Songs, and the playlists made on this
 * device. agents/42 warns against overcrowding, so the shortcuts to Recently
 * played and Made for you are two quiet links at the foot rather than a third
 * and fourth shelf competing with the content.
 *
 * **Rendering this page costs zero provider requests.** Everything shown is
 * metadata already on the device; Audius, Jamendo and YouTube are contacted only
 * when something is actually played (agents/44 → "Opening Library").
 */
export function LibraryPage() {
  const navigate = useNavigate()
  const liked = useLikedTracks('recent')
  const likedCover = useCoverArt(liked)
  const [sort, setSort] = useState<PlaylistSort>('updated')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const summaries = usePlaylistSummaries(sort)
  const status = useLibraryStatus()

  useEffect(() => {
    document.title = 'Your Library — Pulse'
    return () => {
      document.title = 'Pulse — Music Discovery'
    }
  }, [])

  const filtered = useMemo(() => filterPlaylistSummaries(summaries, query), [summaries, query])
  const likedMatchesQuery = useMemo(
    () => query.trim() === '' || 'liked songs'.includes(query.trim().toLowerCase()),
    [query],
  )

  return (
    <section className="search-results library-page">
      <div className="result-title-row">
        <div>
          <p className="eyebrow">Saved on this device</p>
          <h1>Your Library</h1>
        </div>
        <button
          type="button"
          className="library-create"
          onClick={() => setCreating((current) => !current)}
        >
          <Plus size={16} aria-hidden="true" /> New playlist
        </button>
      </div>

      {/* A standing condition rather than an announcement — see SettingsPage. */}
      {status.ephemeral ? (
        <p className="settings-warning">
          This browser is not letting Pulse store anything, so your library will not survive a
          reload. Everything else works normally.
        </p>
      ) : null}

      {creating ? (
        <form
          className="library-create-form"
          onSubmit={(event) => {
            event.preventDefault()
            const result = createPlaylistWithTrack(name)
            if (result.ok && result.playlistId) {
              setCreating(false)
              setName('')
              void navigate(LIBRARY_ROUTES.playlist(result.playlistId))
            }
          }}
        >
          <label htmlFor="new-playlist-name">Playlist name</label>
          <input
            id="new-playlist-name"
            autoFocus
            value={name}
            maxLength={MAX_PLAYLIST_NAME_LENGTH}
            placeholder="Road trip"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" disabled={!name.trim()}>
            Create
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setCreating(false)
              setName('')
            }}
          >
            Cancel
          </button>
        </form>
      ) : null}

      <div className="library-toolbar">
        <div className="library-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find in your library"
            aria-label="Find in your library"
          />
        </div>
        <label className="library-sort">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as PlaylistSort)}
            aria-label="Sort playlists"
          >
            {(Object.keys(PLAYLIST_SORT_LABELS) as PlaylistSort[]).map((option) => (
              <option key={option} value={option}>
                {PLAYLIST_SORT_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="library-grid">
        {likedMatchesQuery ? (
          <Link className="library-card" to={LIBRARY_ROUTES.liked}>
            <PlaylistCover cover={likedCover} variant="liked" />
            <h3>Liked Songs</h3>
            <p>
              {liked.length === 0
                ? 'Nothing yet'
                : `${liked.length} ${liked.length === 1 ? 'song' : 'songs'}`}
            </p>
          </Link>
        ) : null}

        {filtered.map((summary) => (
          <Link
            key={summary.playlist.id}
            className="library-card"
            to={LIBRARY_ROUTES.playlist(summary.playlist.id)}
          >
            <PlaylistCover cover={summary.cover} />
            <h3 title={summary.playlist.name}>{summary.playlist.name}</h3>
            <p>
              {summary.trackCount === 0
                ? 'Empty playlist'
                : `${summary.trackCount} ${summary.trackCount === 1 ? 'song' : 'songs'}`}
            </p>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && !likedMatchesQuery ? (
        <EmptyState
          icon={<Search size={32} aria-hidden="true" />}
          title="Nothing matches that"
          description="Library search looks at the titles, artists and playlist names saved on this device. Nothing is sent to a provider."
        />
      ) : null}

      {summaries.length === 0 && query.trim() === '' ? (
        <EmptyState
          icon={<ListMusic size={32} aria-hidden="true" />}
          title="No playlists yet"
          description="Create a playlist to keep music together."
        />
      ) : null}

      <div className="library-shortcuts">
        <Link to={`/#${HOME_SECTION_ANCHORS.recent}`}>
          <Heart size={15} aria-hidden="true" /> Recently played
        </Link>
        <Link to={`/#${HOME_SECTION_ANCHORS.recommended}`}>
          <ListMusic size={15} aria-hidden="true" /> Made for you
        </Link>
      </div>

      <p className="library-footnote">
        Your library is saved in this browser only. Pulse has no account and no cloud sync, and
        liking something here does not change your Audius, Jamendo or YouTube account.{' '}
        <Link to="/privacy">How this is stored</Link>
      </p>
    </section>
  )
}
