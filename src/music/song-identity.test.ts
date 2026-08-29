import { describe, expect, it } from 'vitest'
import { isSameSongVariant, songIdentity } from './song-identity'

/**
 * The duplicate guard that stops autoplay following *Kosandra* with
 * *Kosandra (Official Audio)*.
 *
 * Two failure modes are tested with equal weight, because they cost different
 * things: missing a cosmetic duplicate is a mildly annoying next track, while
 * collapsing two genuinely different songs silently removes one from autoplay
 * forever. The second is the one to be paranoid about, so most of this file is
 * about what must *not* match.
 */

const song = (title: string, artistName = 'Miyagi & Andy Panda') => ({ title, artistName })

const KOSANDRA = song('Kosandra')

describe('cosmetic variants are the same song', () => {
  it.each([
    'Kosandra',
    'Kosandra (Official Audio)',
    'Kosandra [Official]',
    'Kosandra Lyrics',
    'Kosandra (Official Video)',
    'Kosandra (Remastered)',
    'Kosandra — Official Audio 4K',
    'Kosandra (Lyric Video)',
    'Kosandra (Visualizer)',
  ])('matches %s', (title) => {
    expect(isSameSongVariant(KOSANDRA, song(title))).toBe(true)
  })

  it('ignores punctuation and case differences', () => {
    expect(isSameSongVariant(KOSANDRA, song('KOSANDRA'))).toBe(true)
    expect(isSameSongVariant(KOSANDRA, song('kosandra!'))).toBe(true)
  })

  it('drops "music" only inside "official music video"', () => {
    expect(isSameSongVariant(KOSANDRA, song('Kosandra (Official Music Video)'))).toBe(true)
    // …and never on its own, or "Sheet Music" would collapse into "Sheet".
    expect(
      isSameSongVariant(song('Sheet Music', 'Someone'), song('Sheet', 'Someone')),
    ).toBe(false)
  })

  it('leaves a differently punctuated artist unsuppressed, which is the safe direction', () => {
    // "Miyagi & Andy Panda" vs "Miyagi and Andy Panda" scores 0.89 against a 0.9
    // threshold, so the guard declines to call them the same. The consequence is
    // that a cosmetic duplicate may occasionally play — the mild failure. The
    // alternative, loosening the artist test, risks silently removing a genuine
    // candidate, which is the failure worth avoiding.
    expect(
      isSameSongVariant(KOSANDRA, { title: 'Kosandra', artistName: 'Miyagi and Andy Panda' }),
    ).toBe(false)
  })

  it('is symmetric', () => {
    const other = song('Kosandra (Official Audio)')
    expect(isSameSongVariant(KOSANDRA, other)).toBe(isSameSongVariant(other, KOSANDRA))
  })
})

describe('genuinely different recordings are not the same song', () => {
  it.each([
    ['a remix', 'Kosandra (Remix)'],
    ['a live take', 'Kosandra (Live)'],
    ['an acoustic take', 'Kosandra (Acoustic)'],
    ['an instrumental', 'Kosandra (Instrumental)'],
    ['a slowed edit', 'Kosandra (Slowed + Reverb)'],
    ['a radio edit', 'Kosandra (Radio Edit)'],
    ['a cover', 'Kosandra (Cover)'],
  ])('allows %s through', (_label, title) => {
    // Autoplay may legitimately pick a remix; it is a different thing to hear.
    expect(isSameSongVariant(KOSANDRA, song(title))).toBe(false)
  })

  it('never matches a different song by the same artist', () => {
    expect(isSameSongVariant(KOSANDRA, song('Utopia'))).toBe(false)
    expect(isSameSongVariant(KOSANDRA, song('Silhouette'))).toBe(false)
  })

  it('never matches the same title by a different artist', () => {
    expect(
      isSameSongVariant(KOSANDRA, { title: 'Kosandra', artistName: 'Some Cover Band' }),
    ).toBe(false)
  })

  it('does not match two remixes of one song to each other unless they agree', () => {
    // Same substantive marker and same core title — genuinely one recording.
    expect(
      isSameSongVariant(song('Kosandra (Remix)'), song('Kosandra Remix [Official Audio]')),
    ).toBe(true)
    // Different substantive markers — a remix is not a live take.
    expect(isSameSongVariant(song('Kosandra (Remix)'), song('Kosandra (Live)'))).toBe(false)
  })

  it('refuses to guess when a title is nothing but decoration', () => {
    expect(isSameSongVariant(KOSANDRA, song('Official Audio'))).toBe(false)
    expect(isSameSongVariant(KOSANDRA, song(''))).toBe(false)
  })

  it('refuses to guess when the artist is unknown', () => {
    expect(isSameSongVariant(KOSANDRA, { title: 'Kosandra', artistName: '' })).toBe(false)
  })

  it('does not collapse titles that merely share a word', () => {
    expect(isSameSongVariant(song('Night Signal'), song('Night Drive'))).toBe(false)
    expect(isSameSongVariant(song('Kosandra'), song('Kosandra II'))).toBe(false)
  })
})

describe('non-Latin text survives normalization intact', () => {
  it('matches Cyrillic cosmetic variants', () => {
    const cyrillic = { title: 'Кассандра', artistName: 'Мияги и Эндшпиль' }
    expect(
      isSameSongVariant(cyrillic, {
        title: 'Кассандра (Official Audio)',
        artistName: 'Мияги и Эндшпиль',
      }),
    ).toBe(true)
  })

  it('does not treat a transliteration as the same string', () => {
    // Folding strips diacritics and repairs homoglyphs; it does not transliterate,
    // so these stay two different titles and neither is silently suppressed.
    expect(
      isSameSongVariant(
        { title: 'Кассандра', artistName: 'Мияги' },
        { title: 'Kassandra', artistName: 'Miyagi' },
      ),
    ).toBe(false)
  })

  it('matches Armenian cosmetic variants', () => {
    const armenian = { title: 'Իմ Երգը', artistName: 'Արամ Ասատրյան' }
    expect(
      isSameSongVariant(armenian, { title: 'Իմ Երգը (Official Video)', artistName: 'Արամ Ասատրյան' }),
    ).toBe(true)
  })

  it('keeps two different Armenian songs apart', () => {
    expect(
      isSameSongVariant(
        { title: 'Իմ Երգը', artistName: 'Արամ Ասատրյան' },
        { title: 'Սիրո Պատմություն', artistName: 'Արամ Ասատրյան' },
      ),
    ).toBe(false)
  })

  it('matches Arabic cosmetic variants', () => {
    const arabic = { title: 'أغنية الليل', artistName: 'فنان' }
    expect(isSameSongVariant(arabic, { title: 'أغنية الليل (Official Audio)', artistName: 'فنان' })).toBe(
      true,
    )
  })

  it('keeps two different Arabic songs apart', () => {
    expect(
      isSameSongVariant(
        { title: 'أغنية الليل', artistName: 'فنان' },
        { title: 'أغنية الصباح', artistName: 'فنان' },
      ),
    ).toBe(false)
  })

  it('leaves non-Latin scripts in the identity rather than dropping them', () => {
    const identity = songIdentity({ title: 'Кассандра (Official Audio)', artistName: 'Мияги' })
    expect(identity.coreTitle).toContain('кассандра')
    expect(identity.coreTitle).not.toContain('official')
    expect(identity.artist).toContain('мияги')
  })
})

describe('the identity itself', () => {
  it('separates the core title from its substantive marker', () => {
    const identity = songIdentity(song('Kosandra (Live) [Official Audio]'))
    expect(identity.coreTitle).toBe('kosandra')
    expect(identity.variant).toBe('live')
  })

  it('sorts markers so order in the title does not matter', () => {
    expect(songIdentity(song('Song (Live) (Acoustic)')).variant).toBe(
      songIdentity(song('Song (Acoustic) (Live)')).variant,
    )
  })

  it('gives a plain title an empty variant', () => {
    expect(songIdentity(KOSANDRA).variant).toBe('')
  })
})
