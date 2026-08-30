import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AUTOPLAY_PERMISSION,
  allowsAutoplay,
  ensureAutoplayPermission,
  mergeAllowTokens,
} from './youtube/iframe-adapter'

/**
 * The browser permission a cross-origin embed needs before any script may start
 * it — and the two places it can be lost.
 *
 * This is the configuration half of "the video will not auto-start", and it is
 * worth stating plainly what it is: **permission delegation, not a workaround.**
 * `autoplay`'s default allowlist is `self`. The top document may autoplay; that
 * permission does not reach a cross-origin child frame unless the parent
 * delegates it, and a browser will refuse `playVideo()` in a frame that never
 * received it however visible the player is and however recently anyone tapped.
 *
 * Nothing here spoofs a gesture, mutes anything, or touches YouTube's controls.
 * It makes sure the page is asking the browser the right question; the browser
 * remains entirely free to answer no.
 *
 * Two failure points, one test file:
 *
 * · **The top-level header.** A `Permissions-Policy` that names `autoplay=()`
 *   would make delegation impossible from the page down. Ours does not, and this
 *   pins that it never quietly starts to.
 * · **The iframe attribute.** The IFrame API builds the element and sets its own
 *   `allow` list; current versions include `autoplay`. When one does not, the
 *   token is merged in — without disturbing the rest of the list.
 */

describe('the deployed Permissions-Policy header', () => {
  const header = (() => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      headers?: { source: string; headers: { key: string; value: string }[] }[]
    }
    const all = (config.headers ?? []).flatMap((entry) => entry.headers)
    return all.find((item) => item.key.toLowerCase() === 'permissions-policy')?.value ?? null
  })()

  it('is actually sent, so the policy is a decision rather than a default', () => {
    expect(header).not.toBeNull()
  })

  /**
   * The regression this file exists for.
   *
   * `autoplay=()` in that header disables the feature for the document and every
   * frame under it, and there is no attribute on any iframe that can win it
   * back. Adding it while tidying the security headers would break the saved-list
   * hand-off silently, with no error and no failing unit test anywhere else —
   * the video would simply stop starting, exactly as reported.
   */
  it('never disables autoplay for the document or its frames', () => {
    expect(header).not.toMatch(/autoplay\s*=\s*\(\s*\)/)
  })

  it('delegates autoplay to the app itself and to the YouTube embed origins', () => {
    expect(header).toContain('autoplay=(')
    expect(header).toContain('self')
    expect(header).toContain('https://www.youtube.com')
    expect(header).toContain('https://www.youtube-nocookie.com')
  })

  /** The rest of the policy is a security decision, and this must not relax it. */
  it('still closes camera, microphone, geolocation and payment', () => {
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) {
      expect(header).toContain(`${feature}=()`)
    }
  })
})

describe('merging the autoplay token into an existing allow list', () => {
  it('adds nothing when the token is already there', () => {
    const existing = 'accelerometer; autoplay; encrypted-media; picture-in-picture'
    expect(mergeAllowTokens(existing, [AUTOPLAY_PERMISSION])).toBe(existing)
  })

  /**
   * The destructive version of this is the failure worth guarding against:
   * `setAttribute('allow', 'autoplay')` would strip `encrypted-media` and break
   * DRM playback, and `picture-in-picture`, to fix something that may not even
   * have been broken.
   */
  it('preserves every existing permission when adding one', () => {
    const merged = mergeAllowTokens('encrypted-media; picture-in-picture', [AUTOPLAY_PERMISSION])
    expect(merged).toContain('encrypted-media')
    expect(merged).toContain('picture-in-picture')
    expect(merged).toContain('autoplay')
  })

  it('handles an absent or empty attribute', () => {
    expect(mergeAllowTokens(null, [AUTOPLAY_PERMISSION])).toBe('autoplay')
    expect(mergeAllowTokens('', [AUTOPLAY_PERMISSION])).toBe('autoplay')
  })

  /** A token may carry an allowlist of its own; identity is the feature name. */
  it('recognises a token that already carries an allowlist', () => {
    const existing = "autoplay 'src'; encrypted-media"
    expect(allowsAutoplay(existing)).toBe(true)
    expect(mergeAllowTokens(existing, [AUTOPLAY_PERMISSION])).toBe(existing)
  })

  it('is not fooled by a different feature with a similar name', () => {
    expect(allowsAutoplay('accelerometer; encrypted-media')).toBe(false)
  })
})

describe('delegating autoplay to a generated iframe', () => {
  const iframe = (allow?: string) => {
    const element = document.createElement('iframe')
    if (allow !== undefined) element.setAttribute('allow', allow)
    return element
  }

  it('leaves a frame the API already configured completely alone', () => {
    const element = iframe('accelerometer; autoplay; encrypted-media')
    expect(ensureAutoplayPermission(element)).toBe(false)
    expect(element.getAttribute('allow')).toBe('accelerometer; autoplay; encrypted-media')
  })

  it('adds the token to a frame that lacks it, keeping the rest', () => {
    const element = iframe('encrypted-media; picture-in-picture')
    expect(ensureAutoplayPermission(element)).toBe(true)
    const allow = element.getAttribute('allow') ?? ''
    expect(allowsAutoplay(allow)).toBe(true)
    expect(allow).toContain('encrypted-media')
    expect(allow).toContain('picture-in-picture')
  })

  it('handles a frame with no allow attribute at all', () => {
    const element = iframe()
    expect(ensureAutoplayPermission(element)).toBe(true)
    expect(allowsAutoplay(element.getAttribute('allow'))).toBe(true)
  })

  it('does nothing, and does not throw, without a frame', () => {
    expect(ensureAutoplayPermission(null)).toBe(false)
  })
})
