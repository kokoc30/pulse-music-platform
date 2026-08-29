import { useEffect, useMemo, useState } from 'react'
import { ListMusic, ListPlus, Pencil, Play, Search, Shuffle, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { showNotice } from '@/app/ui-store'
import { EmptyState } from '@/components/feedback/EmptyState'
import { LibraryTrackRow } from '@/components/library/LibraryTrackRow'
import { PlaylistCover } from '@/components/library/PlaylistCover'
import { formatDuration } from '@/lib/format'
import { usePlaylistSummary, usePlaylistTracks } from '@/library/hooks'
import { LIBRARY_ROUTES, libraryMessage, playPlaylist } from '@/library/library-actions'
import { filterTrackRefs } from '@/library/selectors'
import { useLibraryStore } from '@/library/store'
import {
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
} from '@/library/types'
import { useCurrentTrack, useIsPlaying } from '@/player/player-selectors'
import { usePlayerStore } from '@/player/player-store'
import { useYouTubeStore } from '@/player/youtube-store'

/**
 * One playlist.
 *
 * **Play uses the app's one player.** Both buttons call `playPlaylist`, which
 * resolves references through the existing provider path and hands the result to
 * the existing queue. There is no playlist audio element, no second engine and
 * no separate Next — which is what makes the lock screen's Next behave
 * identically to the one on the bar (agents/45 → "One playback path").
 *
 * **Shuffle never rewrites the playlist.** It switches on a running order over
 * the queue before the queue is built; the stored `itemKeys` are untouched, and
 * the rows below stay in their custom order while shuffled playback runs.
 *
 * **Deleting asks first, and deletes only the list.** Its songs stay liked if
 * they were liked and stay in other playlists if they were in them.
 */
export function PlaylistPage() {
  const { playlistId } = useParams<{ playlistId: string }>()
  const navigate = useNavigate()
  const summary = usePlaylistSummary(playlistId)
  const tracks = usePlaylistTracks(playlistId)
  const currentTrack = useCurrentTrack()
  const isPlaying = useIsPlaying()
  const youtubeItem = useYouTubeStore((store) => store.item)
  const setShuffle = usePlayerStore((store) => store.setShuffle)

  const renamePlaylist = useLibraryStore((store) => store.renamePlaylist)
  const describePlaylist = useLibraryStore((store) => store.describePlaylist)
  const deletePlaylist = useLibraryStore((store) => store.deletePlaylist)
  const moveInPlaylist = useLibraryStore((store) => store.moveInPlaylist)
  const removeFromPlaylist = useLibraryStore((store) => store.removeFromPlaylist)

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')

  const playlist = summary?.playlist ?? null

  useEffect(() => {
    document.title = playlist ? `${playlist.name} — Pulse` : 'Playlist — Pulse'
    return () => {
      document.title = 'Pulse — Music Discovery'
    }
  }, [playlist])

  const rows = useMemo(() => filterTrackRefs(tracks, query), [tracks, query])
  const filtering = query.trim() !== ''
  const currentKey = youtubeItem?.id ?? currentTrack?.id ?? null

  if (!summary || !playlist || !playlistId) {
    return (
      <section className="search-results library-detail">
        <EmptyState
          icon={<ListMusic size={32} aria-hidden="true" />}
          title="That playlist is not here"
          description="It may have been deleted on this device, or the link came from another browser — Pulse playlists never leave the browser they were made in."
          action={
            <Link className="retry-button" to={LIBRARY_ROUTES.library}>
              Go to Your Library
            </Link>
          }
        />
      </section>
    )
  }

  const context = { id: `playlist:${playlist.id}`, label: playlist.name }

  /**
   * Playing a *filtered* view would silently play something other than the
   * playlist, so playback always uses the real stored order and maps the clicked
   * row back to its position in it.
   */
  const play = (trackKey: string) => {
    const index = Math.max(
      tracks.findIndex((trackRef) => trackRef.key === trackKey),
      0,
    )
    void playPlaylist(tracks, index, context)
  }

  return (
    <section className="search-results library-detail">
      <header className="library-hero">
        <PlaylistCover cover={summary.cover} />
        <div>
          <p className="eyebrow">Playlist saved in Pulse</p>
          {editing ? (
            <form
              className="library-edit-form"
              onSubmit={(event) => {
                event.preventDefault()
                const renamed = renamePlaylist(playlist.id, draftName)
                if (!renamed.ok) {
                  showNotice(libraryMessage(renamed, ''))
                  return
                }
                describePlaylist(playlist.id, draftDescription)
                setEditing(false)
                showNotice('Playlist updated')
              }}
            >
              <label htmlFor="playlist-name">Name</label>
              <input
                id="playlist-name"
                autoFocus
                value={draftName}
                maxLength={MAX_PLAYLIST_NAME_LENGTH}
                onChange={(event) => setDraftName(event.target.value)}
              />
              <label htmlFor="playlist-description">Description</label>
              <textarea
                id="playlist-description"
                rows={2}
                value={draftDescription}
                maxLength={MAX_PLAYLIST_DESCRIPTION_LENGTH}
                onChange={(event) => setDraftDescription(event.target.value)}
              />
              <div className="settings-actions">
                <button type="button" className="ghost-button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={!draftName.trim()}>
                  Save
                </button>
              </div>
            </form>
          ) : (
            <>
              <h1>{playlist.name}</h1>
              {playlist.description ? (
                <p className="library-hero-description">{playlist.description}</p>
              ) : null}
              <p className="library-hero-meta">
                {summary.trackCount === 0
                  ? 'No songs yet'
                  : `${summary.trackCount} ${summary.trackCount === 1 ? 'song' : 'songs'}`}
                {summary.durationSeconds !== undefined && summary.trackCount > 0
                  ? ` · about ${formatDuration(summary.durationSeconds)}`
                  : ''}
              </p>
            </>
          )}

          <div className="library-hero-actions">
            <button
              type="button"
              className="library-play"
              disabled={tracks.length === 0}
              onClick={() => {
                setShuffle(false)
                void playPlaylist(tracks, 0, context)
              }}
            >
              <Play size={16} fill="currentColor" aria-hidden="true" /> Play
            </button>
            <button
              type="button"
              className="library-shuffle"
              disabled={tracks.length === 0}
              onClick={() => {
                setShuffle(true)
                void playPlaylist(tracks, 0, context)
              }}
            >
              <Shuffle size={16} aria-hidden="true" /> Shuffle
            </button>
            {editing ? null : (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setDraftName(playlist.name)
                  setDraftDescription(playlist.description ?? '')
                  setEditing(true)
                }}
              >
                <Pencil size={15} aria-hidden="true" /> Edit details
              </button>
            )}
            <button
              type="button"
              className="ghost-button"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={15} aria-hidden="true" /> Delete
            </button>
          </div>

          {confirmingDelete ? (
            <div className="library-confirm" role="status">
              <span>
                Delete “{playlist.name}”? The songs stay in Liked Songs and in any other playlist
                that holds them.
              </span>
              <div className="settings-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    deletePlaylist(playlist.id)
                    showNotice('Playlist deleted')
                    void navigate(LIBRARY_ROUTES.library)
                  }}
                >
                  Delete playlist
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {tracks.length > 0 ? (
        <div className="library-toolbar">
          <div className="library-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find in this playlist"
              aria-label="Find in this playlist"
            />
          </div>
          {filtering ? (
            <p className="library-filter-note">
              Showing matches only. Reordering is available in the full list.
            </p>
          ) : null}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="song-list" data-testid="playlist-list">
          {rows.map((trackRef, index) => {
            const position = tracks.findIndex((candidate) => candidate.key === trackRef.key)
            return (
              <LibraryTrackRow
                key={trackRef.key}
                trackRef={trackRef}
                index={filtering ? index : position}
                isCurrent={currentKey === trackRef.key}
                isPlaying={isPlaying}
                onPlay={() => play(trackRef.key)}
                // Reordering is offered only in the real order. Moving row 2 of a
                // filtered view would move something the visitor cannot see.
                {...(filtering
                  ? {}
                  : {
                      playlistControls: {
                        index: position,
                        total: tracks.length,
                        onMove: (to: number) => {
                          moveInPlaylist(playlist.id, position, to)
                        },
                        onRemove: () => {
                          removeFromPlaylist(playlist.id, trackRef.key)
                          showNotice('Removed from playlist')
                        },
                      },
                    })}
              />
            )
          })}
        </div>
      ) : tracks.length > 0 ? (
        <EmptyState
          icon={<Search size={32} aria-hidden="true" />}
          title="Nothing matches that"
          description="This searches only what is saved on this device."
        />
      ) : (
        <EmptyState
          icon={<ListPlus size={32} aria-hidden="true" />}
          title="Add songs from Search, Home or Recently Played."
          description="Use the ⋯ menu on any track and choose Add to playlist."
        />
      )}

      <p className="library-footnote">
        <Link to={LIBRARY_ROUTES.library}>Back to Your Library</Link>
      </p>
    </section>
  )
}
