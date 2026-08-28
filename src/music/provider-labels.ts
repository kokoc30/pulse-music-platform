import type { ProviderId } from './types'

/**
 * Display names for the catalogues, used wherever a track has to credit its
 * source (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md).
 *
 * Kept out of the component file so that file exports components only, which is
 * what React Fast Refresh needs to update it without a full reload.
 */
const LABELS: Record<ProviderId, string> = {
  audius: 'Audius',
  jamendo: 'Jamendo',
}

export function providerLabel(provider: ProviderId): string {
  return LABELS[provider]
}
