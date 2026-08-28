import { useDiscovery } from '@/features/discovery/useDiscovery'
import { playTrack } from '@/player/player-actions'
import { SHELF_TITLES } from '@/features/discovery/shelves'

/**
 * The reference's `.join-strip` acquisition banner. V1 has no accounts, ads or
 * payments, so the copy states what is actually true and the button performs the
 * app's real primary action (docs/reference-deviations.md D-08).
 */
export function JoinStrip() {
  const { trending } = useDiscovery()
  const canPlay = trending.length > 0

  return (
    <section className="join-strip" aria-label="About Pulse">
      <div>
        <b>Free and open listening</b>
        <span>Stream the Audius catalogue straight away. No account, no ads, no card.</span>
      </div>
      <button
        type="button"
        disabled={!canPlay}
        onClick={() => {
          const first = trending[0]
          if (!first) return
          void playTrack(first, {
            queue: trending,
            index: 0,
            context: { id: 'shelf:trending', label: SHELF_TITLES.trending },
          })
        }}
      >
        Play trending
      </button>
    </section>
  )
}
