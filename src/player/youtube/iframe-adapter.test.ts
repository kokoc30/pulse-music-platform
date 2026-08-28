import { describe, expect, it } from 'vitest'
import {
  IFRAME_API_SRC,
  YT_STATE,
  describePlayerError,
  describePlayerState,
} from './iframe-adapter'

describe('the official IFrame API mapping', () => {
  it('maps every documented YT.PlayerState value', () => {
    expect(YT_STATE).toEqual({
      UNSTARTED: -1,
      ENDED: 0,
      PLAYING: 1,
      PAUSED: 2,
      BUFFERING: 3,
      CUED: 5,
    })
    expect(describePlayerState(YT_STATE.UNSTARTED)).toBe('unstarted')
    expect(describePlayerState(YT_STATE.ENDED)).toBe('ended')
    expect(describePlayerState(YT_STATE.PLAYING)).toBe('playing')
    expect(describePlayerState(YT_STATE.PAUSED)).toBe('paused')
    expect(describePlayerState(YT_STATE.BUFFERING)).toBe('buffering')
    expect(describePlayerState(YT_STATE.CUED)).toBe('cued')
    expect(describePlayerState(42)).toBe('unstarted')
  })

  it('maps every documented onError code to safe copy', () => {
    expect(describePlayerError(2)).toMatch(/video id/i)
    expect(describePlayerError(5)).toMatch(/embedded player/i)
    expect(describePlayerError(100)).toMatch(/unavailable/i)
    expect(describePlayerError(101)).toMatch(/outside YouTube/i)
    expect(describePlayerError(150)).toMatch(/outside YouTube/i)
    expect(describePlayerError(999)).toBe('YouTube could not play this video.')
  })

  it('never suggests looking for a mirror copy of a blocked video', () => {
    // agents/24 → "Errors": do not search for mirror copies automatically, and
    // do not invite the visitor to either.
    for (const code of [2, 5, 100, 101, 150, 0]) {
      expect(describePlayerError(code)).not.toMatch(/mirror|another copy|reupload/i)
    }
  })

  it('loads the official script, from YouTube, and nothing else', () => {
    expect(IFRAME_API_SRC).toBe('https://www.youtube.com/iframe_api')
  })
})
