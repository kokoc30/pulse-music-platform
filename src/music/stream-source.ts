import { getMusicProvider } from './provider'
import { MusicError } from './types'
import type { Track } from './types'

/**
 * Resolves the URL the one global audio element loads, for any provider.
 *
 * This is the whole of the multi-provider playback change. The engine, the
 * store, the controls and the queue are untouched: a Jamendo track differs only
 * in *where its URL comes from*, so provider routing lives here and nowhere
 * else (agents/07_PLAYER_BEHAVIOR.md → "Single Audio Engine").
 *
 * · **Audius** resolves lazily through the SDK, because its stream URL is signed
 *   and node-specific and must be fetched at play time.
 * · **Jamendo** hands out a stable HTTPS storage URL with the search result, so
 *   the track already carries it.
 *
 * In both cases the browser streams straight from the provider. Nothing is
 * proxied, buffered into memory, cached or re-hosted by this application.
 */
export async function resolveStreamSource(
  track: Track,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  if (track.provider === 'jamendo') {
    const url = track.streamUrl?.trim()
    if (!url || !/^https:\/\//i.test(url)) {
      throw new MusicError('NOT_STREAMABLE', "This track isn't available to stream.")
    }
    return url
  }
  return getMusicProvider().getStreamSource(track, options)
}

/**
 * Tells the owning provider that a URL it resolved would not play, so the next
 * attempt can route around an unhealthy host. Only Audius has anything to do
 * here — Jamendo serves one storage origin, and re-requesting it would return
 * the identical URL.
 */
export function reportStreamFailure(track: Track | null, streamUrl: string | null): void {
  if (!streamUrl || track?.provider === 'jamendo') return
  getMusicProvider().reportStreamFailure?.(streamUrl)
}
