import { useState } from 'react'
import { ListPlus, Play } from 'lucide-react'
import { showNotice } from '@/app/ui-store'
import { PlaylistCover } from '@/components/library/PlaylistCover'
import { trackRefFromTrack } from '@/library/track-ref'
import { useLibraryStore } from '@/library/store'
import { libraryMessage } from '@/library/library-actions'
import { coverArtFor } from '@/library/selectors'
import type { Mix } from '@/library/mixes'
import { MAX_PLAYLIST_NAME_LENGTH } from '@/library/types'

interface MixCardProps {
  mix: Mix
  onPlay: () => void
  state?: 'idle' | 'loading' | 'playing'
}

/**
 * One made-for-you mix, in the reference's `.media-card` geometry.
 *
 * **Save as playlist takes a snapshot.** The mix itself is virtual: it is
 * recomputed whenever the profile or library changes, so what it holds tomorrow
 * is not what it holds today. Saving it writes the *current order* into an
 * ordinary local playlist, which from then on is an independent object that
 * nothing regenerates — which is the point of the action (agents/43 → "After
 * saving, it no longer automatically changes").
 *
 * The default name carries the date, because a visitor who saves *Your Mix*
 * three weeks running should end up with three distinguishable playlists rather
 * than three called the same thing.
 */
export function MixCard({ mix, onPlay, state = 'idle' }: MixCardProps) {
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const createPlaylist = useLibraryStore((store) => store.createPlaylist)
  const addToPlaylist = useLibraryStore((store) => store.addToPlaylist)

  const cover = coverArtFor(mix.tracks.map((track) => trackRefFromTrack(track)))

  const defaultName = `${mix.title} · ${new Date().toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`

  const save = (playlistName: string) => {
    const [head, ...rest] = mix.tracks
    if (!head) return
    const created = createPlaylist({
      name: playlistName,
      description: `Saved from ${mix.title} on this device.`,
      track: trackRefFromTrack(head),
    })
    if (!created.ok || !created.playlistId) {
      showNotice(libraryMessage(created, ''))
      return
    }
    // The snapshot is the order shown, appended in sequence.
    for (const track of rest) {
      addToPlaylist(created.playlistId, trackRefFromTrack(track))
    }
    setSaving(false)
    setName('')
    showNotice(`Saved ${mix.tracks.length} songs to “${playlistName.trim()}”`)
  }

  return (
    <article className="media-card mix-card">
      <div className="art-wrap">
        <PlaylistCover cover={cover} />
        <button
          type="button"
          className="card-play"
          data-active={state !== 'idle' ? 'true' : 'false'}
          aria-label={`Play ${mix.title}`}
          onClick={onPlay}
        >
          <Play size={18} fill="currentColor" aria-hidden="true" />
        </button>
        <span className="card-actions">
          <button
            type="button"
            className="track-menu-trigger"
            aria-label={`Save ${mix.title} as a playlist in Pulse`}
            aria-expanded={saving}
            onClick={() => {
              setName(defaultName)
              setSaving((current) => !current)
            }}
          >
            <ListPlus size={16} aria-hidden="true" />
          </button>
        </span>
      </div>

      <h3 title={mix.title}>{mix.title}</h3>
      <p>{`${mix.tracks.length} songs · ${mix.description}`}</p>

      {saving ? (
        <form
          className="mix-save-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!name.trim()) return
            save(name)
          }}
        >
          <label htmlFor={`save-${mix.id}`}>Playlist name</label>
          <input
            id={`save-${mix.id}`}
            autoFocus
            value={name}
            maxLength={MAX_PLAYLIST_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="settings-actions">
            <button type="button" className="ghost-button" onClick={() => setSaving(false)}>
              Cancel
            </button>
            <button type="submit" disabled={!name.trim()}>
              Save as playlist
            </button>
          </div>
        </form>
      ) : null}
    </article>
  )
}
