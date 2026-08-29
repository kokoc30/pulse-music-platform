import { useEffect, useId, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Check,
  EyeOff,
  ListPlus,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import { showNotice } from '@/app/ui-store'
import { usePlaylistSummaries } from '@/library/hooks'
import {
  addRefToPlaylist,
  createPlaylistWithTrack,
  markNotInterested,
  undoNotInterested,
} from '@/library/library-actions'
import { MAX_PLAYLIST_NAME_LENGTH } from '@/library/types'
import type { LibraryTrackRef } from '@/library/types'

export interface PlaylistItemControls {
  /** Position of this row within the playlist, for the move actions. */
  index: number
  total: number
  onMove: (to: number) => void
  onRemove: () => void
}

interface TrackMenuProps {
  /** Title, for accessible names. */
  title: string
  /** Builds the saved reference. Called only when something is actually saved. */
  toRef: () => LibraryTrackRef
  /** `provider:providerItemId`, needed by *Not interested*. */
  itemKey: string
  /** Offered only on generated recommendation surfaces. */
  canHide?: boolean
  /** Present only inside a playlist, where reorder and remove make sense. */
  playlistControls?: PlaylistItemControls
}

/**
 * The per-item overflow menu: *Add to playlist*, and whatever else the surface
 * supports.
 *
 * **Reorder lives here on purpose.** agents/42 requires keyboard-accessible move
 * controls and explicitly forbids drag-only reordering. Move up, Move down, Move
 * to top and Move to bottom are ordinary menu items, so they work with a
 * keyboard, a screen reader and a thumb, with no pointer gesture anywhere in the
 * path. Dragging, where a browser offers it, is an addition to this rather than
 * the way in.
 *
 * **No network request.** Adding to a playlist writes locally and shows a toast.
 * Nothing here contacts Audius, Jamendo or YouTube, and nothing here touches a
 * provider account.
 *
 * The menu is a plain popover rather than a modal: normal success is a toast,
 * and a dialog for "added to a playlist" would be heavier than the action.
 */
export function TrackMenu({
  title,
  toRef,
  itemKey,
  canHide = false,
  playlistControls,
}: TrackMenuProps) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const playlists = usePlaylistSummaries('updated')

  const close = (returnFocus = true) => {
    setOpen(false)
    setCreating(false)
    setName('')
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  const move = (to: number) => {
    playlistControls?.onMove(to)
    close()
  }

  return (
    <div
      className="track-menu"
      data-open={open ? 'true' : 'false'}
      ref={containerRef}
      // These menus live inside rows and cards whose container click starts
      // playback. Every interaction inside the menu is a menu interaction.
      onClick={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className="track-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`More actions for ${title}`}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>

      {open ? (
        <div className="track-menu-popover" id={menuId} role="menu" aria-label={`Actions for ${title}`}>
          {playlistControls ? (
            <>
              <p className="track-menu-heading">Order in this playlist</p>
              <button
                type="button"
                role="menuitem"
                disabled={playlistControls.index === 0}
                onClick={() => move(playlistControls.index - 1)}
              >
                <ArrowUp size={15} aria-hidden="true" /> Move up
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={playlistControls.index >= playlistControls.total - 1}
                onClick={() => move(playlistControls.index + 1)}
              >
                <ArrowDown size={15} aria-hidden="true" /> Move down
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={playlistControls.index === 0}
                onClick={() => move(0)}
              >
                <ArrowUpToLine size={15} aria-hidden="true" /> Move to top
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={playlistControls.index >= playlistControls.total - 1}
                onClick={() => move(playlistControls.total - 1)}
              >
                <ArrowDownToLine size={15} aria-hidden="true" /> Move to bottom
              </button>
              <button
                type="button"
                role="menuitem"
                className="track-menu-destructive"
                onClick={() => {
                  playlistControls.onRemove()
                  close()
                }}
              >
                <Trash2 size={15} aria-hidden="true" /> Remove from this playlist
              </button>
              <hr />
            </>
          ) : null}

          <p className="track-menu-heading">Add to playlist</p>

          {playlists.length === 0 && !creating ? (
            <p className="track-menu-note">No playlists yet.</p>
          ) : null}

          {playlists.map((summary) => {
            const already = summary.playlist.itemKeys.includes(itemKey)
            return (
              <button
                key={summary.playlist.id}
                type="button"
                role="menuitem"
                disabled={already}
                aria-label={
                  already
                    ? `${title} is already in ${summary.playlist.name}`
                    : `Add ${title} to ${summary.playlist.name} in Pulse`
                }
                onClick={() => {
                  addRefToPlaylist(summary.playlist.id, toRef())
                  close()
                }}
              >
                {already ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <ListPlus size={15} aria-hidden="true" />
                )}
                <span className="track-menu-label">{summary.playlist.name}</span>
                {already ? <span className="track-menu-hint">Already added</span> : null}
              </button>
            )
          })}

          {creating ? (
            <form
              className="track-menu-create"
              onSubmit={(event) => {
                event.preventDefault()
                if (!name.trim()) return
                createPlaylistWithTrack(name, toRef())
                close()
              }}
            >
              <label htmlFor={`${menuId}-name`}>New playlist name</label>
              <input
                id={`${menuId}-name`}
                autoFocus
                value={name}
                maxLength={MAX_PLAYLIST_NAME_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder="Road trip"
              />
              <div className="track-menu-create-actions">
                <button type="button" className="ghost-button" onClick={() => setCreating(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={!name.trim()}>
                  Create
                </button>
              </div>
            </form>
          ) : (
            <button type="button" role="menuitem" onClick={() => setCreating(true)}>
              <Plus size={15} aria-hidden="true" /> New playlist
            </button>
          )}

          {canHide ? (
            <>
              <hr />
              <button
                type="button"
                role="menuitem"
                aria-label={`Stop recommending ${title}`}
                onClick={() => {
                  const result = markNotInterested(itemKey)
                  close()
                  if (!result.ok) return
                  // Undo lives on the toast: the row has already left the shelf,
                  // so nothing local is still mounted to own the reversal, and a
                  // mis-tap costs one click rather than a trip to Settings.
                  showNotice('Hidden from your recommendations.', {
                    label: 'Undo',
                    run: () => undoNotInterested(itemKey),
                  })
                }}
              >
                <EyeOff size={15} aria-hidden="true" /> Not interested
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
