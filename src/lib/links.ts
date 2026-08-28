/**
 * Outbound links. Only URLs verified to resolve are listed here — the app never
 * invents a provider page (agents/12_AGENT_EXECUTION_RULES.md → Rule 8).
 */
export const AUDIUS_LINKS = {
  app: 'https://audius.co',
  docs: 'https://docs.audius.co',
  source: 'https://github.com/AudiusProject/apps',
  terms: 'https://audius.co/legal/terms-of-use',
  privacy: 'https://audius.co/legal/privacy-policy',
  cookies: 'https://audius.co/legal/cookie-policy',
} as const

/**
 * Third-party policy pages linked from the privacy disclosure
 * (agents/26_YOUTUBE_PRIVACY_MFK_DATA.md → "Privacy"). Each is the provider's
 * own canonical page — nothing here is paraphrased or mirrored.
 */
export const EXTERNAL_LINKS = {
  googlePrivacy: 'https://policies.google.com/privacy',
  youtubeTerms: 'https://www.youtube.com/t/terms',
  jamendoPrivacy: 'https://www.jamendo.com/legal/privacy-policy',
} as const
