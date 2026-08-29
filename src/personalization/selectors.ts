import { RECENT_SHELF_SIZE } from './config'
import { recentlyPlayed } from './history'
import type { ProfileStage } from './profile'
import { canReplayStoredYouTubeEntry } from './youtube-retention'
import type { ListenEntry, PersonalizationState } from './types'

/**
 * What the home page shows, as a pure function of the local profile.
 *
 * The reference design carries exactly five content shelves above the footer,
 * and Phase 4 keeps that count at every stage. Personalization changes *which*
 * five and in what order — it never grows the page, because a dashboard that
 * doubles in length once you have listened to something is a worse dashboard
 * (STEP 9 → "Do not make the dashboard visually overcrowded").
 *
 * Availability is an input rather than an afterthought. A stage may *prefer*
 * "Recommended for you", but if the candidate pool could not fill it, the slot
 * is given back to discovery instead of rendering an empty shelf (STEP 14).
 */

export type HomeSectionId =
  | 'mixes'
  | 'recommended'
  | 'recent'
  | 'because'
  | 'artists'
  | 'trending'
  | 'popular-artists'
  | 'month'
  | 'stations'
  | 'charts'

/** Shelves above the footer. Matches the reference exactly, at every stage. */
export const HOME_SECTION_COUNT = 5

/**
 * Always the closing shelf, as in the reference. It is static, cannot fail and
 * carries no personalization, so it is the one fixed point of the layout.
 */
const CLOSING_SECTION: HomeSectionId = 'charts'

/** Preferred personalized shelves per stage, best first. */
const STAGE_PREFERENCES: Record<ProfileStage, HomeSectionId[]> = {
  /**
   * `mixes` appears even at cold, and that is not a contradiction.
   *
   * `stage` measures *listening*, and it is the right gate for shelves that make
   * a claim about listening. Phase 7 introduced a second, independent kind of
   * evidence: things the visitor deliberately saved. Someone who has liked five
   * tracks without finishing a listen has told the app more than someone who
   * half-played five — so gating their mixes on a listening stage would be the
   * dishonest answer, not the cautious one.
   *
   * The honesty guarantee lives where the evidence does: `buildMixes` returns
   * nothing without enough of it, and `hasMixes` here is simply whether one
   * could actually be built. A browser with no library and no history still gets
   * exactly the Phase 1–3 discovery page (agents/43 → "Cold start").
   */
  cold: ['mixes'],
  // Two clicks are not a taste profile. The honest offer at this stage is "here
  // is what you just played", not "here is what we think you like" (STEP 9).
  early: ['mixes', 'recent'],
  // Once listening supports them too, mixes lead: they are the strongest thing
  // the app can say, and they are only ever offered with evidence behind them.
  warm: ['mixes', 'recommended', 'recent', 'artists'],
  mature: ['mixes', 'recommended', 'recent', 'because', 'artists'],
}

/** Discovery shelves, in the order they are handed back unused slots. */
const DISCOVERY_ORDER: HomeSectionId[] = ['trending', 'popular-artists', 'month', 'stations']

export interface HomePlanInput {
  stage: ProfileStage
  /** True when at least one made-for-you mix could actually be filled. */
  hasMixes?: boolean
  hasRecommendations: boolean
  hasRecent: boolean
  hasBecause: boolean
  hasArtistShelf: boolean
}

const AVAILABILITY: Record<string, (input: HomePlanInput) => boolean> = {
  mixes: (input) => input.hasMixes === true,
  recommended: (input) => input.hasRecommendations,
  recent: (input) => input.hasRecent,
  because: (input) => input.hasBecause,
  artists: (input) => input.hasArtistShelf,
}

/**
 * The ordered shelf list for one render.
 *
 * Personalized shelves that can actually be filled come first, discovery fills
 * whatever is left, and `charts` always closes. The result is length
 * `HOME_SECTION_COUNT` in every reachable case, because `DISCOVERY_ORDER` alone
 * is long enough to fill the page.
 */
export function planHomeSections(input: HomePlanInput): HomeSectionId[] {
  /**
   * Having played something is not the same as having a taste profile.
   *
   * `stage` is computed from catalogue listens only, because YouTube metadata
   * may not feed a cross-provider preference score. But *Recently played* is not
   * a preference score — it is a list of what this browser played, which is
   * simply true. So a visitor whose only history is YouTube still gets the
   * shelf, while the recommendation shelves stay correctly out of reach.
   */
  const effectiveStage = input.stage === 'cold' && input.hasRecent ? 'early' : input.stage

  const personalized = STAGE_PREFERENCES[effectiveStage].filter((id) =>
    AVAILABILITY[id] ? AVAILABILITY[id](input) : true,
  )

  const sections: HomeSectionId[] = []
  const slots = HOME_SECTION_COUNT - 1

  for (const id of personalized) {
    if (sections.length >= slots) break
    sections.push(id)
  }
  for (const id of DISCOVERY_ORDER) {
    if (sections.length >= slots) break
    sections.push(id)
  }

  sections.push(CLOSING_SECTION)
  return sections
}

/** Headings. Personalized copy never makes a claim about who the listener is. */
export const HOME_SECTION_TITLES: Record<HomeSectionId, string> = {
  mixes: 'Made for you',
  recommended: 'Recommended for you',
  recent: 'Recently played',
  because: 'Because you listened to',
  artists: 'More from artists you like',
  trending: 'Trending songs',
  'popular-artists': 'Popular artists',
  month: 'Popular this month',
  stations: 'Popular radio',
  charts: 'Featured Charts',
}

/** Anchor ids, so the header and footer utility links keep working. */
export const HOME_SECTION_ANCHORS: Record<HomeSectionId, string> = {
  mixes: 'made-for-you',
  recommended: 'recommended',
  recent: 'recently-played',
  because: 'because',
  artists: 'your-artists',
  trending: 'trending',
  'popular-artists': 'artists',
  month: 'this-month',
  stations: 'stations',
  charts: 'charts',
}

/* --------------------------------------------------------------------------
   Recently played (STEP 10)
   -------------------------------------------------------------------------- */

/**
 * The Recently Played shelf.
 *
 * Ordered most-recent-first and already deduplicated, because history is keyed
 * on `provider:providerItemId` — replaying something moves it to the front
 * rather than adding a row.
 *
 * A YouTube entry survives here only while three things hold: its retention
 * window is open, YouTube reported it as embeddable, and YouTube explicitly
 * reported it as not made for kids. An entry failing any of those is dropped
 * from the shelf entirely rather than offered as an unplayable card.
 */
export function recentShelf(
  state: PersonalizationState,
  now = Date.now(),
  limit = RECENT_SHELF_SIZE,
): ListenEntry[] {
  return recentlyPlayed(state.listeningHistory, now)
    .filter((entry) => entry.provider !== 'youtube' || canReplayStoredYouTubeEntry(entry, now))
    .slice(0, limit)
}

/** True when there is anything at all to show in Recently Played. */
export function hasRecentlyPlayed(state: PersonalizationState, now = Date.now()): boolean {
  return recentShelf(state, now, 1).length > 0
}
