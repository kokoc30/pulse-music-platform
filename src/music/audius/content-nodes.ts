/**
 * Content-node failover for stream URLs.
 *
 * Audius resolves each `/tracks/{id}/stream` request to one of many
 * community-run content nodes. Nodes go bad — at the time of writing one
 * advertised node answers every request with `ERR_SSL_PACKET_LENGTH_TOO_LONG` —
 * and the API keeps routing the same track to the same node, so simply asking
 * again does not help.
 *
 * The signature in a stream URL covers `{cid, timestamp, trackId, userId}`, not
 * the host, so the identical signed path can be replayed against a different
 * content node. That is the same failover model Audius publishes for artwork via
 * `artwork.mirrors`, and the node list comes from Audius' own `/health_check`
 * payload (`data.network.content_nodes`) — the field the SDK's storage-node
 * selector reads. Verified against the live network before shipping.
 */

/** The SDK pins this as its production API root (verified in `createSdk`). */
const AUDIUS_API_ROOT = 'https://api.audius.co'

/** Hosts that failed to play in this session. In-memory only. */
const failedOrigins = new Set<string>()

let nodesPromise: Promise<string[]> | null = null

function toOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

interface HealthCheckPayload {
  data?: { network?: { content_nodes?: Array<{ endpoint?: unknown }> } }
}

/** Content nodes Audius advertises. Fetched at most once per session. */
export async function getAdvertisedContentNodes(): Promise<string[]> {
  nodesPromise ??= (async () => {
    try {
      const response = await fetch(`${AUDIUS_API_ROOT}/health_check`)
      if (!response.ok) return []
      const payload = (await response.json()) as HealthCheckPayload
      const nodes = payload.data?.network?.content_nodes ?? []
      return nodes
        .map((node) => (typeof node.endpoint === 'string' ? node.endpoint.replace(/\/+$/, '') : ''))
        .filter((endpoint) => /^https:\/\//i.test(endpoint))
    } catch {
      // Failover is a nicety; never let it break playback resolution.
      return []
    }
  })()
  return nodesPromise
}

/** Records that a resolved stream URL could not be played. */
export function reportFailedStreamOrigin(streamUrl: string): void {
  const origin = toOrigin(streamUrl)
  if (origin) failedOrigins.add(origin)
}

export function isOriginKnownBad(streamUrl: string): boolean {
  const origin = toOrigin(streamUrl)
  return origin !== null && failedOrigins.has(origin)
}

export function resetStreamOriginFailures(): void {
  failedOrigins.clear()
  nodesPromise = null
}

/**
 * Returns the URL unchanged unless its host has already failed this session, in
 * which case the same signed path is re-pointed at a healthy advertised node.
 */
export async function resolveHealthyStreamUrl(streamUrl: string): Promise<string> {
  if (!isOriginKnownBad(streamUrl)) return streamUrl

  let parsed: URL
  try {
    parsed = new URL(streamUrl)
  } catch {
    return streamUrl
  }

  const candidates = await getAdvertisedContentNodes()
  const replacement = candidates.find(
    (node) => node !== parsed.origin && !failedOrigins.has(node),
  )
  if (!replacement) return streamUrl

  return `${replacement}${parsed.pathname}${parsed.search}`
}
