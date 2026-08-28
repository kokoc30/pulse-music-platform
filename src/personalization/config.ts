/**
 * Every tunable number in the personalization layer, in one place.
 *
 * They live here rather than inline so the rules are inspectable, testable and
 * impossible to fork: no component may re-derive a threshold, and changing one
 * changes it everywhere (STEP 3 → "Centralize this rule").
 */

/* --------------------------------------------------------------------------
   Qualified listen (STEP 3)
   -------------------------------------------------------------------------- */

/** Absolute ceiling: half an hour of a long track is never required. */
export const QUALIFY_MAX_SECONDS = 30
/** Fraction of a known duration that counts as a real listen. */
export const QUALIFY_DURATION_RATIO = 0.25
/**
 * Absolute floor. Below this, a play is indistinguishable from a misclick, so
 * very short content simply does not train the profile (STEP 3).
 */
export const QUALIFY_MIN_SECONDS = 10

/** A play abandoned inside this window counts as an early skip. */
export const EARLY_SKIP_SECONDS = 10

/** `>= this` of a track counts as a completion. */
export const COMPLETION_RATIO = 0.8

/* --------------------------------------------------------------------------
   Retention (STEP 5)
   -------------------------------------------------------------------------- */

/** Rolling cap on distinct catalogue items kept. */
export const MAX_HISTORY_ITEMS = 250
/** Rolling age cap for Audius/Jamendo history. */
export const MAX_HISTORY_DAYS = 180
/** Rolling cap on distinct submitted searches. */
export const MAX_SEARCH_HISTORY = 50
/** Rolling cap on dismissed-item ids. */
export const MAX_DISMISSED_ITEMS = 100

/**
 * Hard retention limit for locally stored YouTube API metadata.
 *
 * YouTube API Services Developer Policies III.E.4.d: an API client "may
 * temporarily store limited amounts of Non-Authorized Data ... but not longer
 * than 30 calendar days". Public search metadata is Non-Authorized Data, so 30
 * days is the ceiling and this constant may never be raised
 * (docs/youtube-personalization-policy-audit.md §3).
 */
export const YOUTUBE_RETENTION_DAYS = 30

/* --------------------------------------------------------------------------
   Recency decay (STEP 8)
   -------------------------------------------------------------------------- */

/** Days after which an interaction counts half as much as it did when fresh. */
export const RECENCY_HALF_LIFE_DAYS = 21
/** Floor so a genuinely old favourite never reaches exactly zero. */
export const MIN_RECENCY_DECAY = 0.02

/* --------------------------------------------------------------------------
   Interaction weights (STEP 4)
   -------------------------------------------------------------------------- */

export const WEIGHTS = {
  /** A play that crossed the qualification threshold. */
  qualified: 1,
  /** A click that never qualified. Deliberately near-zero, not zero. */
  unqualifiedPlay: 0.05,
  /** Added once when the best observed completion reaches `COMPLETION_RATIO`. */
  completion: 0.5,
  /** Added once when the item was played on two or more distinct days. */
  distinctDay: 0.5,
  /** Subtracted per early skip. */
  earlySkip: 0.25,
  /** Floor, so a heavily skipped item contributes nothing rather than negatively. */
  minimum: 0,
} as const

/** Repeat listening compounds, but logarithmically and with a ceiling. */
export const REPEAT_LOG_FACTOR = 0.6
export const MAX_REPEAT_FACTOR = 2.5

/* --------------------------------------------------------------------------
   Profile stages (STEP 9)
   -------------------------------------------------------------------------- */

/** Qualified listens needed to leave cold start. */
export const EARLY_PROFILE_LISTENS = 1
/** Qualified listens needed before real recommendations are offered. */
export const WARM_PROFILE_LISTENS = 3
/** Qualified listens after which discovery becomes secondary. */
export const MATURE_PROFILE_LISTENS = 8

/* --------------------------------------------------------------------------
   Recommendations (STEP 11–13)
   -------------------------------------------------------------------------- */

/** Rows a personalized shelf shows. Matches the reference's four cards. */
export const SHELF_SIZE = 4
/** Never let one artist take over a shelf (STEP 12). */
export const MAX_TRACKS_PER_ARTIST = 2
/**
 * Share of a recommendation shelf reserved for exploration rather than
 * preference alignment, so the profile cannot close in on itself (STEP 12).
 */
export const EXPLORATION_RATIO = 0.25
/** Items played within this window are held back from recommendation shelves. */
export const RECENTLY_PLAYED_COOLDOWN_HOURS = 24
/** Qualified plays after which an item is "overplayed" for recommendation purposes. */
export const OVERPLAYED_COUNT = 3
/** Items shown by the Recently Played shelf. */
export const RECENT_SHELF_SIZE = 4
/**
 * Minimum share of the profile's total artist weight a seed must hold before
 * "Because you listened to …" is allowed to name it (STEP 13).
 */
export const MIN_SEED_AFFINITY = 0.18
/** Minimum qualified plays a seed artist must have. */
export const MIN_SEED_PLAYS = 2
/**
 * Hard ceiling on extra provider requests one home render may make, ever
 * (STEP 11 → "No request fan-out explosion"). Zero of these go to YouTube.
 */
export const MAX_AFFINITY_LOOKUPS = 2

export const MS_PER_DAY = 86_400_000
export const MS_PER_HOUR = 3_600_000

/**
 * Alternate artwork origins kept per history row.
 *
 * Enough to survive the handful of unhealthy Audius content nodes seen in
 * practice, small enough that a provider publishing a long mirror list cannot
 * inflate stored history.
 */
export const MAX_ARTWORK_MIRRORS = 4

/* --------------------------------------------------------------------------
   Search dropdown (Phase 5)
   -------------------------------------------------------------------------- */

/** Recent searches offered in the dropdown. Bounded so it never grows tall. */
export const RECENT_SEARCH_SUGGESTIONS = 6
/** Recently played rows offered beneath them. */
export const RECENT_PLAYED_SUGGESTIONS = 4
