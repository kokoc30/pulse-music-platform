import { searchJamendoTracks } from '@/music/jamendo'
import { getMusicProvider } from '@/music/provider'
import { detectScript } from '@/music/search'
import type { Script } from '@/music/search'
import { artistHintFromTitle } from '@/music/song-identity'
import { isYouTubeVideoItem } from '@/music/types'
import type { MediaItem, MediaProviderId, Track, YouTubeVideoItem } from '@/music/types'
import { canEmbedYouTubeItem, searchYouTubeVideos } from '@/music/youtube'

/**
 * "Find more like this" — one question, asked the same way for every provider.
 *
 * The rule this module exists to serve is blunt: **playback never stops on its
 * own.** Someone who put on a Russian pop song should get another Russian pop
 * song when it ends, without coming back to the app to pick one. When the
 * explicit queue runs out, this is where the next few items come from.
 *
 * It owns no playback and no queue. It answers a query and returns items; the
 * two engines' own action layers decide what to do with them, exactly as they
 * decide everything else about their queues. That separation is what keeps this
 * testable as arithmetic over metadata plus one provider call.
 *
 * **One request per call, always.** Each provider is asked once, and a failure —
 * network, quota, an empty catalogue — returns an empty array rather than
 * throwing. Nothing here retries; the callers own the single delayed retry the
 * "never stop" rule asks for, because they are the ones who know whether
 * anything else is still playable in the meantime.
 */

/** Items one call asks the provider for, and at most returns. */
export const RELATED_LIMIT = 10

/**
 * How many playable items must stand ahead of the listener at all times.
 *
 * Checked when a track *starts*, not when it ends, so the lookup happens over
 * the three minutes of music already playing rather than in the silence after
 * it. Three is enough to absorb a failed lookup and an unplayable candidate
 * without the gap ever being heard.
 */
export const MIN_QUEUE_DEPTH = 3

/**
 * The one delayed retry, for the case where the network dropped mid-track.
 *
 * A single retry, not a loop: if the second attempt also comes back empty the
 * callers say so in the bar and stop. Silence with an explanation is the only
 * acceptable ending; replaying the track that just finished is not.
 */
export const RELATED_RETRY_DELAY_MS = 2_000

/** Ids the session remembers, so a continuation cannot circle back on itself. */
export const PLAYED_SESSION_LIMIT = 100

/**
 * What the bar says when every source has been asked and none answered.
 *
 * One wording for both engines, because it describes one situation. It is the
 * *only* acceptable ending to a session: playback stopping with an explanation.
 * Restarting what just finished is not an alternative to it.
 */
export const NO_MORE_TRACKS_MESSAGE = "Can't find more tracks right now."

/**
 * What a related lookup needs to know about the thing that is playing.
 *
 * Deliberately not a `Track` and not a `YouTubeVideoItem`: the two models have
 * almost nothing in common, and every rule below applies to both. Building this
 * descriptor once is what lets the query builder be one function rather than a
 * pair that drift.
 */
export interface RelatedSeed {
  /** The item's own id, always excluded from its own results. */
  id: string
  title: string
  artist: string
  /** ISO 639-1 where the app can tell, e.g. `ru`. Absent when it cannot. */
  language?: string
  genre?: string
  tags?: string[]
  provider: MediaProviderId
}

/** What a lookup returns: a queue item for whichever engine asked. */
export type RelatedItem = Track | YouTubeVideoItem

export interface FetchRelatedOptions {
  signal?: AbortSignal
  /** Ids to exclude beyond the seed and the session's own history. */
  exclude?: Iterable<string>
  limit?: number
  /** Test seams. Each replaces exactly one provider call. */
  searchAudius?: (
    query: string,
    options: { limit: number; signal?: AbortSignal },
  ) => Promise<Track[]>
  searchJamendo?: typeof searchJamendoTracks
  searchYouTube?: typeof searchYouTubeVideos
}

/* --------------------------------------------------------------------------
   Language
   -------------------------------------------------------------------------- */

/**
 * Scripts that name a language on their own.
 *
 * Cyrillic is read as Russian, and that is a deliberate approximation rather
 * than a claim: Russian is by far the largest Cyrillic music catalogue on every
 * provider here, and the alternative — treating a Cyrillic title as having no
 * language at all — is what produced the reported bug, where a Russian pop track
 * was followed by an English one. Latin says nothing, because a dozen languages
 * share it; those are answered by tags instead.
 */
const SCRIPT_LANGUAGES: Partial<Record<Script, { code: string; word: string }>> = {
  cyrillic: { code: 'ru', word: 'russian' },
  armenian: { code: 'hy', word: 'armenian' },
  arabic: { code: 'ar', word: 'arabic' },
}

/**
 * Language words providers actually publish as tags.
 *
 * Tags outrank script detection because they are the provider's own statement,
 * and they reach the Latin-script languages script detection cannot separate.
 * First word listed for a code is the one a query is built from.
 */
const TAG_LANGUAGES: Record<string, string> = {
  russian: 'ru',
  russia: 'ru',
  русский: 'ru',
  русская: 'ru',
  spanish: 'es',
  espanol: 'es',
  latino: 'es',
  reggaeton: 'es',
  french: 'fr',
  francais: 'fr',
  german: 'de',
  deutsch: 'de',
  italian: 'it',
  italiano: 'it',
  portuguese: 'pt',
  brazilian: 'pt',
  turkish: 'tr',
  turkce: 'tr',
  armenian: 'hy',
  arabic: 'ar',
  hebrew: 'he',
  greek: 'el',
  polish: 'pl',
  ukrainian: 'uk',
  hindi: 'hi',
  bollywood: 'hi',
  korean: 'ko',
  kpop: 'ko',
  japanese: 'ja',
  jpop: 'ja',
  chinese: 'zh',
  mandarin: 'zh',
}

/**
 * The search word for a language code — the inverse of the table above.
 *
 * Built from the *first* word listed for each code, so `ru` resolves to
 * `russian` rather than to whichever synonym happened to come last.
 */
const LANGUAGE_WORDS: Record<string, string> = (() => {
  const words: Record<string, string> = {}
  for (const [word, code] of Object.entries(TAG_LANGUAGES)) {
    words[code] ??= word
  }
  return words
})()

/** A tag reduced to the form the language table is keyed on. */
function tagKey(tag: string): string {
  return tag.toLowerCase().replace(/[\s_-]+/gu, '')
}

/**
 * The language of the thing playing, or nothing.
 *
 * Order matters and follows how much each source actually knows: a tag the
 * provider published beats a guess from the alphabet, and a guess from the
 * alphabet beats nothing. Returning `undefined` is a real answer — a
 * Latin-script track with no language tag is searched by its tags and genre
 * instead, which is the right query for it.
 */
export function detectLanguage(
  seed: Pick<RelatedSeed, 'title' | 'artist' | 'tags'>,
): string | undefined {
  for (const tag of seed.tags ?? []) {
    const code = TAG_LANGUAGES[tagKey(tag)]
    if (code) return code
  }
  return SCRIPT_LANGUAGES[detectScript(`${seed.title} ${seed.artist}`)]?.code
}

/** The word a query uses for a language code. `ru` → `russian`. */
export function languageWord(code: string | undefined): string | undefined {
  return code ? LANGUAGE_WORDS[code] : undefined
}

/* --------------------------------------------------------------------------
   Describing the seed
   -------------------------------------------------------------------------- */

/**
 * Reads a playing item into the shape a lookup needs.
 *
 * The YouTube branch takes its artist from `artistHintFromTitle` when the title
 * confidently parses as `Artist - Title`, because a channel name is very often
 * a re-uploader rather than the act — the same reasoning, and the same helper,
 * that keeps autoplay from following Kosandra with Kosandra.
 */
export function describeSeed(item: MediaItem): RelatedSeed {
  if (isYouTubeVideoItem(item)) {
    const hint = artistHintFromTitle(item.title)
    const artist = hint?.artist ?? item.channelTitle
    const seed: RelatedSeed = { id: item.id, title: item.title, artist, provider: 'youtube' }
    const language = detectLanguage(seed)
    return language ? { ...seed, language } : seed
  }

  const seed: RelatedSeed = {
    id: item.id,
    title: item.title,
    artist: item.artistName,
    provider: item.provider,
    ...(item.genre ? { genre: item.genre } : {}),
    ...(item.tags?.length ? { tags: item.tags } : {}),
  }
  const language = detectLanguage(seed)
  return language ? { ...seed, language } : seed
}

/* --------------------------------------------------------------------------
   The query
   -------------------------------------------------------------------------- */

/**
 * Tags that describe a recording rather than name one.
 *
 * A tag repeating the artist or a word of the title turns the query back into a
 * search for the same song, which is the one result a continuation must not
 * return.
 */
function descriptiveTags(seed: RelatedSeed): string[] {
  const own = new Set(
    `${seed.title} ${seed.artist}`
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  )
  const picked: string[] = []
  for (const raw of seed.tags ?? []) {
    const tag = raw.trim().toLowerCase()
    if (tag.length < 2) continue
    if (/^\d+$/u.test(tag)) continue
    if (own.has(tag)) continue
    if (picked.includes(tag)) continue
    picked.push(tag)
    if (picked.length === 3) break
  }
  return picked
}

/**
 * The one search string a lookup spends its single request on.
 *
 * Audio and video are built differently because the two catalogues describe
 * music differently, not because anyone preferred it that way:
 *
 * · **Audius and Jamendo publish tags and a genre.** Those describe the *kind*
 *   of music, so they produce a query that returns other artists in the same
 *   vein — which is what "next related track" means. The language word is
 *   prepended when the tags do not already carry one, so a Cyrillic-titled pop
 *   track searches for `russian pop` rather than for `pop`.
 * · **A YouTube result carries neither.** All it has is a title and a channel,
 *   so the act is the query, widened by the language and the word `music`.
 *   YouTube's own search expands an artist into that artist's scene, which is
 *   the closest thing available to the `relatedToVideoId` parameter Google
 *   withdrew in August 2023.
 *
 * Never returns the title. A search for the title returns the track that just
 * played, thirteen re-uploads of it, and nothing else — the exact failure the
 * Kosandra investigation documented.
 */
export function relatedQuery(seed: RelatedSeed): string {
  const word = languageWord(seed.language)

  if (seed.provider === 'youtube') {
    return [seed.artist.trim(), word, 'music'].filter(Boolean).join(' ').trim()
  }

  const tags = descriptiveTags(seed)
  if (tags.length) {
    // Only when no tag already says it: `russian russianrap` helps nobody.
    const carriesLanguage = tags.some((tag) => TAG_LANGUAGES[tagKey(tag)])
    return [carriesLanguage ? undefined : word, ...tags].filter(Boolean).join(' ')
  }

  const fromGenre = [word, seed.genre].filter(Boolean).join(' ').trim()
  if (fromGenre) return fromGenre

  // Nothing described it at all. The act itself is still a real answer.
  return seed.artist.trim()
}

/* --------------------------------------------------------------------------
   Session history
   -------------------------------------------------------------------------- */

/**
 * Everything this session has already started.
 *
 * Module-level rather than in a store, and deliberately: it is not state any
 * surface renders, it must be shared by two stores that know nothing about each
 * other, and it must not be persisted — a continuation is a property of the
 * sitting, not of the account.
 *
 * Insertion-ordered and capped, so a long session evicts its oldest memory
 * instead of growing without bound. A `Set` preserves insertion order, which is
 * what makes the eviction the *oldest* rather than an arbitrary one.
 */
const played = new Set<string>()

/** Called the moment an item starts, by both engines. */
export function notePlayed(id: string): void {
  // Re-inserting must move the id to the newest position, or a track played
  // twice would still be evicted on its original schedule.
  played.delete(id)
  played.add(id)
  while (played.size > PLAYED_SESSION_LIMIT) {
    const oldest = played.values().next()
    if (oldest.done) break
    played.delete(oldest.value)
  }
}

export function hasPlayedInSession(id: string): boolean {
  return played.has(id)
}

/** Read-only view, oldest first. Tests and diagnostics. */
export function playedSessionIds(): readonly string[] {
  return [...played]
}

/** Test seam, and the reset a fresh app instance performs. */
export function clearPlayedSession(): void {
  played.clear()
}

/* --------------------------------------------------------------------------
   The lookup
   -------------------------------------------------------------------------- */

async function fetchAudiusRelated(
  query: string,
  options: FetchRelatedOptions,
  limit: number,
): Promise<Track[]> {
  const signal = options.signal ? { signal: options.signal } : {}
  if (options.searchAudius) return options.searchAudius(query, { limit, ...signal })
  return getMusicProvider().searchTracks(query, { limit, ...signal })
}

async function fetchJamendoRelated(
  query: string,
  options: FetchRelatedOptions,
  limit: number,
): Promise<Track[]> {
  const search = options.searchJamendo ?? searchJamendoTracks
  const result = await search(query, {
    limit,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  return result.tracks
}

async function fetchYouTubeRelated(
  query: string,
  options: FetchRelatedOptions,
): Promise<YouTubeVideoItem[]> {
  const search = options.searchYouTube ?? searchYouTubeVideos
  const result = await search(query, { ...(options.signal ? { signal: options.signal } : {}) })
  // An item the app may not embed is not a continuation: it is a dead end that
  // would strand the listener on an error. Same predicate the rows and the
  // player use, so there is no second copy of the policy check.
  return result.videos.filter(canEmbedYouTubeItem)
}

/**
 * Items to play after this one, from the provider that is already playing.
 *
 * **One request, one provider, no retry, never throws.** An empty array is a
 * legitimate answer and the callers treat it as one: it means "ask again in two
 * seconds, then tell them", not "something went wrong".
 *
 * The seed itself, everything the session has already played, and anything the
 * caller names are all excluded — because a continuation that returns the track
 * that just finished is indistinguishable from the looping bug this replaces.
 *
 * Audio providers are asked for twice the wanted count, because the exclusions
 * above and the same-song rule downstream both cut into the answer; YouTube is
 * not, because its endpoint takes no limit and the quota is far too scarce to
 * spend on a widened one.
 */
export async function fetchRelated(
  seed: RelatedSeed,
  options: FetchRelatedOptions = {},
): Promise<RelatedItem[]> {
  const limit = options.limit ?? RELATED_LIMIT
  if (limit <= 0) return []

  const query = relatedQuery(seed)
  if (!query) return []

  let found: readonly RelatedItem[]
  try {
    if (seed.provider === 'youtube') {
      found = await fetchYouTubeRelated(query, options)
    } else if (seed.provider === 'jamendo') {
      found = await fetchJamendoRelated(query, options, limit * 2)
    } else {
      found = await fetchAudiusRelated(query, options, limit * 2)
    }
  } catch {
    // Including a caller abort. A continuation is a convenience: a cancelled or
    // failed lookup is fewer candidates, never an error anybody has to see.
    return []
  }

  const excluded = new Set<string>([seed.id, ...(options.exclude ?? [])])
  const results: RelatedItem[] = []
  for (const item of found) {
    if (excluded.has(item.id)) continue
    if (hasPlayedInSession(item.id)) continue
    if (item.mediaKind === 'audio' && !item.isStreamable) continue
    excluded.add(item.id)
    results.push(item)
    if (results.length === limit) break
  }
  return results
}
