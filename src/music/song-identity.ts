import { normalizeText } from '@/music/search/text'
import { diceCoefficient } from '@/music/search/similarity'

/**
 * "Are these two rows the same song?" — for **automatic** next-track selection.
 *
 * The problem this solves is specific. A catalogue routinely carries the same
 * recording several times over: *Kosandra*, *Kosandra (Official Audio)*,
 * *Kosandra Lyrics*, *Kosandra (Remastered)*. Exact-id exclusion cannot see that
 * they are one song, so autoplay happily follows a track with a cosmetic reissue
 * of itself — which reads as a bug even though every id is different.
 *
 * **Why this is not `cross-provider-dedupe.ts`.** That module answers a
 * different question — "may I *hide* one of these two search results?" — and its
 * answers are tuned for that. Three differences matter:
 *
 * · It refuses to compare two items from the same provider. Here they must be
 *   compared: two Audius uploads of one song is the common case.
 * · It requires the durations to agree within three seconds. A "Lyrics" upload
 *   of the same master often runs a few seconds longer, so duration is used
 *   here only as corroboration, never as a requirement.
 * · It treats *remastered* as a distinguishing marker, because a remaster is a
 *   genuinely different master that a searcher may want to see. For "what should
 *   play next", it is the same song and picking it is the exact annoyance being
 *   fixed.
 *
 * Merging the two would mean one set of thresholds serving two questions, and
 * the wrong answer to at least one of them. They deliberately share only their
 * primitives (`normalizeText`, `diceCoefficient`).
 *
 * **Conservative by construction.** A false positive here silently removes a
 * legitimate candidate from autoplay; a false negative merely lets one through.
 * So every rule below is biased towards *not* matching: a different artist, a
 * different substantive version, an unreadable title or a weak similarity all
 * mean "different song".
 */

/**
 * Words that describe the *upload*, not the recording.
 *
 * Two titles differing only by these are the same song for autoplay purposes.
 * `remaster`/`remastered` sit here deliberately — see the module comment.
 */
const COSMETIC_MARKERS = new Set([
  'official',
  'officiel',
  'audio',
  'video',
  'visualizer',
  'visualiser',
  'lyrics',
  'lyric',
  'lyricvideo',
  'hd',
  'hq',
  'uhd',
  '4k',
  '1080p',
  '720p',
  'mv',
  'full',
  'remaster',
  'remastered',
  'anniversary',
  'clip',
])

/**
 * Words that make this a *different* recording.
 *
 * A remix, a live take or a cover is a legitimately different thing to play
 * next, so autoplay is allowed to choose one. Two titles whose substantive
 * markers differ are therefore never treated as the same song.
 */
const SUBSTANTIVE_MARKERS = new Set([
  'remix',
  'rmx',
  'mix',
  'live',
  'acoustic',
  'unplugged',
  'instrumental',
  'karaoke',
  'cover',
  'edit',
  'radio',
  'extended',
  'club',
  'dub',
  'demo',
  'reprise',
  'rework',
  'bootleg',
  'mashup',
  'vip',
  'session',
  'sessions',
  'version',
  'slowed',
  'reverb',
  'sped',
  'speedup',
  'nightcore',
  'orchestral',
  'piano',
  'karaoké',
])

/** Articles that carry no identity. Deliberately tiny. */
const NOISE_TOKENS = new Set(['the', 'a', 'an'])

/**
 * `music` is cosmetic only inside the phrase "official music video".
 *
 * Stripping it unconditionally would be the easy fix and the wrong one:
 * *Sheet Music* and *Sheet* would then collapse into one song. So it is dropped
 * only when the title also carries a word that makes it a description of the
 * upload rather than part of the name.
 */
const CONDITIONAL_MARKERS = new Set(['music'])
const CONDITIONAL_CONTEXT = new Set(['video', 'official'])

/**
 * Titles must be near-identical once decoration is stripped. Same value as the
 * search deduper uses, for the same reason: below this, two titles are related
 * rather than identical.
 */
export const MIN_TITLE_SIMILARITY = 0.92
/** A cover by a different act is a different recording, so artists must agree. */
export const MIN_ARTIST_SIMILARITY = 0.9

export interface SongLike {
  title: string
  artistName: string
}

/**
 * The separator a "Artist - Title" upload uses, with real spacing around it.
 *
 * Spaces are required on both sides. Without them `Jay-Z`, `Anne-Marie` and
 * `Lo-Fi Beats` would all split into an artist and a title, which is precisely
 * the kind of confident nonsense this parser must not produce. An en or em dash
 * counts too, because uploaders use them interchangeably with a hyphen.
 */
const TITLE_ARTIST_SEPARATOR = /\s+[-–—]\s+/

/**
 * The artist a *re-upload* is really by, when the title says so.
 *
 * Audius carries the same recording many times over from throwaway accounts:
 * `Miyagi & Andy Panda - Kosandra (Official Audio)` uploaded by `tttyyu7`,
 * `ldhcuhu`, `ssss` and a dozen more. The uploader lands in `artistName`, so
 * thirteen copies of one song look like thirteen different artists — and the
 * artist clause below then declares them all *different songs*, which is exactly
 * how autoplay ended up following Kosandra with Kosandra.
 *
 * So when a title confidently parses as `Artist - Title`, the parsed half is
 * used as the identity artist instead of the uploader.
 *
 * **The bounds matter more than the parse.** This is used for one question —
 * "is autoplay about to play the same song again?" — and nowhere else. It never
 * rewrites `Track.artistName`, never reaches provider attribution, and never
 * decides what is displayed or credited: a re-upload is still shown and still
 * linked exactly as the provider described it. `null` on anything ambiguous,
 * because a wrong guess here silently removes a legitimate candidate.
 */
export function artistHintFromTitle(title: string): { artist: string; title: string } | null {
  const parts = title.split(TITLE_ARTIST_SEPARATOR)
  // Exactly one separator. `A - B - C` is ambiguous about which half is which.
  if (parts.length !== 2) return null

  const [left, right] = parts
  const artist = normalizeText(left ?? '')
  const rest = normalizeText(right ?? '')
  if (!artist.folded || !rest.folded) return null

  // A leading track number — `02 - Galis es ancnum` — is not an artist.
  if (/^\d+$/.test(artist.folded.replace(/\s+/g, ''))) return null
  // Nor is a single character, or something implausibly long for a name.
  if (artist.folded.length < 2 || artist.tokens.length > 6) return null

  return { artist: artist.folded, title: right ?? '' }
}

export interface SongIdentity {
  /** Folded artist name. Empty when the artist is unreadable. */
  artist: string
  /** Folded title with cosmetic decoration and articles removed. */
  coreTitle: string
  /** Substantive version markers, sorted and joined — the "which take" key. */
  variant: string
}

/**
 * The comparable identity of a song.
 *
 * Folding runs through `normalizeText`, which strips diacritics and repairs
 * homoglyphs **without transliterating**: Cyrillic stays Cyrillic, Armenian
 * stays Armenian, Arabic stays Arabic. `Кассандра` and `Kosandra` are not the
 * same string here and are not meant to be.
 */
/** Splits a title's tokens into its identifying core and its version markers. */
function foldTitle(title: string): { coreTitle: string; variant: string } {
  const { tokens } = normalizeText(title)
  const hasContext = tokens.some((token) => CONDITIONAL_CONTEXT.has(token))

  const core: string[] = []
  const markers = new Set<string>()
  for (const token of tokens) {
    if (SUBSTANTIVE_MARKERS.has(token)) {
      markers.add(token)
      continue
    }
    if (COSMETIC_MARKERS.has(token) || NOISE_TOKENS.has(token)) continue
    if (hasContext && CONDITIONAL_MARKERS.has(token)) continue
    core.push(token)
  }

  return { coreTitle: core.join(' '), variant: [...markers].sort().join('|') }
}

export function songIdentity(song: SongLike): SongIdentity {
  const whole = foldTitle(song.title)

  /**
   * A confidently parseable `Artist - Title` overrides the uploader.
   *
   * Accepted only when the right-hand half still names something after
   * decoration is stripped. `Kosandra — Official Audio 4K` parses cleanly as a
   * pair, but its right half is nothing but decoration, which means the dash
   * separated a title from its own labels rather than an artist from a title —
   * so the whole string stays the title and the provider's artist stands.
   */
  const hint = artistHintFromTitle(song.title)
  const parsed = hint ? foldTitle(hint.title) : null

  if (hint && parsed?.coreTitle) {
    return { artist: hint.artist, coreTitle: parsed.coreTitle, variant: parsed.variant }
  }

  return {
    artist: normalizeText(song.artistName).folded,
    coreTitle: whole.coreTitle,
    variant: whole.variant,
  }
}

/**
 * Identity is derived on the playback path, so it is cached per object.
 *
 * A `WeakMap` keyed on the track keeps this free for the repeated scoring passes
 * the autoplay planner makes, and holds nothing alive.
 */
const identityCache = new WeakMap<SongLike, SongIdentity>()

export function cachedSongIdentity(song: SongLike): SongIdentity {
  const hit = identityCache.get(song)
  if (hit) return hit
  const identity = songIdentity(song)
  identityCache.set(song, identity)
  return identity
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  return diceCoefficient(a, b)
}

/**
 * True only when two rows are the same recording wearing different labels.
 *
 * Every clause is a reason to say *no*:
 *
 * 1. an unreadable artist or title is no evidence at all;
 * 2. different substantive markers mean different takes — a remix is not the
 *    original, and autoplay may legitimately choose it;
 * 3. the artists must be near-identical, so *Kosandra* by someone else stays a
 *    separate song;
 * 4. the core titles must be near-identical, not merely similar.
 */
export function isSameSongVariant(a: SongLike, b: SongLike): boolean {
  const left = cachedSongIdentity(a)
  const right = cachedSongIdentity(b)

  if (!left.coreTitle || !right.coreTitle) return false
  if (!left.artist || !right.artist) return false
  if (left.variant !== right.variant) return false
  if (similarity(left.artist, right.artist) < MIN_ARTIST_SIMILARITY) return false
  return similarity(left.coreTitle, right.coreTitle) >= MIN_TITLE_SIMILARITY
}
