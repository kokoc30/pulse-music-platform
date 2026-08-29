import { useMemo } from 'react'
import { useLibraryState } from '@/library/hooks'
import { buildMixes } from '@/library/mixes'
import type { Mix } from '@/library/mixes'
import { catalogLibraryRefs } from '@/library/selectors'
import type { Track } from '@/music/types'
import type { PersonalizationProfile } from '@/personalization/profile'
import { usePersonalizationStore } from '@/personalization/store'
import { sessionTracks } from '@/player/autoplay/session-pool'
import { usePlayerStore } from '@/player/player-store'

/**
 * Made-for-you mixes for the home page.
 *
 * **Recomputed on change, not on tick.** The memo depends on the profile object,
 * the library state object and the candidate pool — each of which is a new
 * reference only when something meaningful actually happened. A `timeupdate` at
 * 4 Hz, a keystroke or a progress-bar render does not rebuild a mix
 * (agents/43 → "Do not regenerate every playback second").
 *
 * **Zero requests.** The pool is the discovery shelves the page already loaded
 * plus the Phase 6 session pool — tracks this session has already seen, held in
 * memory and costing nothing. No mix has ever caused a provider call.
 *
 * **Consent is respected without a branch here.** With personalization off the
 * profile is the empty one, which has no evidence, so `buildMixes` returns
 * nothing and the home page keeps its discovery shelves. The library still works
 * exactly as it did; it simply does not shape recommendations.
 */
export function useMadeForYouMixes(candidates: readonly Track[]): Mix[] {
  const profile = usePersonalizationStore((store) => store.profile)
  const history = usePersonalizationStore((store) => store.state.listeningHistory)
  const library = useLibraryState()
  const queue = usePlayerStore((store) => store.queue)

  return useMemo(() => {
    // Session tracks are read inside the memo rather than subscribed to: the
    // pool is a by-product of browsing, and a mix should not rebuild itself
    // every time a shelf happens to render.
    const pool = [...candidates, ...sessionTracks()]
    return buildMixes({
      profile,
      saved: catalogLibraryRefs(library),
      candidates: pool,
      history,
      hidden: library.hiddenRecommendationKeys,
      queuedIds: queue.map((track) => track.id),
    })
  }, [profile, library, candidates, history, queue])
}

/** True when mixes should take a home slot. Kept beside the builder it mirrors. */
export function hasMixes(mixes: readonly Mix[]): boolean {
  return mixes.length > 0
}

export type { Mix, PersonalizationProfile }
