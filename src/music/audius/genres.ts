/**
 * Canonical Audius genre strings.
 *
 * The Audius API only accepts its own genre vocabulary, so UI labels are never
 * sent as-is (agents/06_AUDIUS_INTEGRATION.md). Every value below was verified
 * against the live API to return results.
 */
export const AUDIUS_GENRES = {
  electronic: 'Electronic',
  hipHop: 'Hip-Hop/Rap',
  house: 'House',
  lofi: 'Lo-Fi',
  techno: 'Techno',
  ambient: 'Ambient',
  drumAndBass: 'Drum & Bass',
  pop: 'Pop',
  deepHouse: 'Deep House',
} as const

export type AudiusGenreKey = keyof typeof AUDIUS_GENRES
export type AudiusGenre = (typeof AUDIUS_GENRES)[AudiusGenreKey]

export function isAudiusGenre(value: string): value is AudiusGenre {
  return Object.values(AUDIUS_GENRES).includes(value as AudiusGenre)
}
