import { Heart } from 'lucide-react'
import { useIsLiked } from '@/library/hooks'
import { toggleLibraryLikeRef } from '@/library/library-actions'
import type { LibraryTrackRef } from '@/library/types'

interface LikeButtonProps {
  /** `provider:providerItemId` — the identity the whole library is keyed on. */
  itemKey: string
  /** Title, for the accessible name. */
  title: string
  /**
   * Builds the saved reference. Called only when the heart is actually pressed,
   * so a page of fifty rows does not construct fifty references it will never
   * use, and a row that is never liked costs one `Set.has` per render.
   */
  toRef: () => LibraryTrackRef
  size?: number
  /** Row hearts stay dim until hover or focus; the player bar's is always shown. */
  variant?: 'row' | 'prominent'
}

/**
 * The one heart in the application.
 *
 * Search rows, home cards, Recently Played, the player bar, the queue and every
 * library row render *this* component reading *this* store, which is why the
 * state can never disagree between two surfaces: there is no second copy of
 * "is this liked" to fall out of sync (agents/42 → "one canonical Pulse-local
 * heart state").
 *
 * **It is a Pulse action, and the label says so.** Pulse has no provider OAuth,
 * so this changes nothing on Audius, Jamendo or YouTube. The accessible name is
 * *Save … to Liked Songs in Pulse* rather than a bare "Like", because a bare
 * "Like" beside a provider's logo would read as a claim about that provider's
 * own like count (agents/44 → "Clear disclosure").
 *
 * `stopPropagation` matters: these hearts sit inside rows and cards whose
 * container click starts playback, and pressing the heart must never also start
 * the track.
 */
export function LikeButton({
  itemKey,
  title,
  toRef,
  size = 16,
  variant = 'row',
}: LikeButtonProps) {
  const liked = useIsLiked(itemKey)

  return (
    <button
      type="button"
      className="like-button"
      data-liked={liked ? 'true' : 'false'}
      data-variant={variant}
      aria-pressed={liked}
      title={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs in Pulse'}
      aria-label={
        liked
          ? `Remove ${title} from Liked Songs in Pulse`
          : `Save ${title} to Liked Songs in Pulse`
      }
      onClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        toggleLibraryLikeRef(toRef())
      }}
    >
      <Heart size={size} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  )
}
