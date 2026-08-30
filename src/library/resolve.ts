import { multiProviderSearch } from '@/music/aggregator'
import { getMusicProvider } from '@/music/provider'
import type { Track } from '@/music/types'
import type { LibraryTrackRef } from './types'

/**
 * Turning a saved *reference* back into something playable.
 *
 * Split out of `library-actions.ts` so that the two things which need it — the
 * one-off *play this saved item* path, and the collection-playback engine — can
 * both import it without importing each other. Nothing here plays anything, and
 * nothing here knows about a queue.
 */

/** Simultaneous provider lookups. Enough to feel instant, small enough to be polite. */
export const RESOLVE_CONCURRENCY = 4

/**
 * Re-resolves one saved reference to a playable `Track`.
 *
 * The same strategy Recently Played uses, and for the same reason: Audius stream
 * URLs are signed, node-specific and expiring, and Jamendo's are `streamUrl`s
 * that may not be persisted at all. So a saved item is re-asked for at play
 * time. Audius has a lookup by id; Jamendo's proxy exposes only search, so the
 * item is found by one bounded search and matched on its *provider id* — never
 * on title similarity, which would risk playing a different recording than the
 * one that was saved.
 */
export async function resolveLibraryTrack(ref: LibraryTrackRef): Promise<Track | null> {
  if (ref.provider === 'audius') {
    return getMusicProvider().getTrack(ref.providerItemId)
  }
  if (ref.provider === 'jamendo') {
    const result = await multiProviderSearch(`${ref.title} ${ref.artist}`)
    return (
      result.tracks.find(
        (track) => track.provider === 'jamendo' && track.providerId === ref.providerItemId,
      ) ?? null
    )
  }
  // A YouTube reference is never a `Track`. It plays in YouTube's own embedded
  // player or not at all, which is what keeps it off the audio element.
  return null
}

/** Resolution that answers "no" instead of throwing. One item is not the list. */
export async function resolveQuietly(ref: LibraryTrackRef): Promise<Track | null> {
  try {
    const track = await resolveLibraryTrack(ref)
    return track?.isStreamable ? track : null
  } catch {
    // One item that has left the catalogue must not fail the whole collection.
    return null
  }
}

/** Resolves many references, preserving order, with bounded concurrency. */
export async function resolveMany(refs: readonly LibraryTrackRef[]): Promise<(Track | null)[]> {
  const results: (Track | null)[] = refs.map(() => null)
  let cursor = 0

  const worker = async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= refs.length) return
      results[index] = await resolveQuietly(refs[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(RESOLVE_CONCURRENCY, refs.length) }, () => worker()),
  )
  return results
}
