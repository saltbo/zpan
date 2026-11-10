import { describe, expect, it } from 'vitest'
import { decidePlaybackPlan, type MediaFacts, type MediaTrackFacts, type PlaybackCapabilities } from './plan'

const H264 = 'avc1.64001f'
const AAC = 'mp4a.40.2'

function track(id: number, codec: string | null, codecString: string | null, isDefault = false): MediaTrackFacts {
  return { id, codec, codecString, isDefault }
}

function facts(overrides: Partial<MediaFacts> = {}): MediaFacts {
  return {
    containerMime: 'video/x-matroska',
    video: track(1, 'avc', H264, true),
    audio: [track(2, 'aac', AAC, true)],
    ...overrides,
  }
}

/** Models a Chromium-like browser: MP4/MKV with H.264 + AAC native, MSE for H.264/AAC/Opus only. */
function caps(overrides: Partial<PlaybackCapabilities> = {}): PlaybackCapabilities {
  return {
    canPlayNatively: (mime) => mime === 'video/mp4' || (/avc1/.test(mime) && !/ac-3|ec-3|dtsc|mlpa/.test(mime)),
    mseAvailable: true,
    canPlayThroughMse: (mime) => /avc1|mp4a|opus/.test(mime),
    softDecodableAudio: new Set(['ac3', 'eac3', 'dts', 'aac', 'opus']),
    ...overrides,
  }
}

describe('decidePlaybackPlan', () => {
  it('plays natively when the browser accepts the container and both codecs', () => {
    expect(decidePlaybackPlan(facts(), caps())).toEqual({ kind: 'native' })
  })

  it('transcodes AC-3 audio while copying the video', () => {
    const plan = decidePlaybackPlan(facts({ audio: [track(2, 'ac3', 'ac-3', true)] }), caps())
    expect(plan).toEqual({ kind: 'remux', videoTrackId: 1, audioTrackId: 2, transcodeAudio: true })
  })

  it('remuxes without transcoding when only the container is unplayable (MKV on Safari)', () => {
    const plan = decidePlaybackPlan(facts(), caps({ canPlayNatively: () => false }))
    expect(plan).toEqual({ kind: 'remux', videoTrackId: 1, audioTrackId: 2, transcodeAudio: false })
  })

  it('keeps the default track even when a copyable alternative exists', () => {
    const plan = decidePlaybackPlan(
      facts({ audio: [track(2, 'dts', 'dts', true), track(3, 'aac', AAC)] }),
      caps({ canPlayNatively: () => false }),
    )
    expect(plan).toMatchObject({ kind: 'remux', audioTrackId: 2, transcodeAudio: true })
  })

  it('falls back to another track when the default cannot be decoded at all', () => {
    const plan = decidePlaybackPlan(
      facts({ audio: [track(2, 'truehd', 'mlpa', true), track(3, 'ac3', 'ac-3')] }),
      caps(),
    )
    expect(plan).toMatchObject({ kind: 'remux', audioTrackId: 3, transcodeAudio: true })
  })

  it('uses the first track when none is marked default', () => {
    const plan = decidePlaybackPlan(facts({ audio: [track(2, 'eac3', 'ec-3'), track(3, 'dts', 'dts')] }), caps())
    expect(plan).toMatchObject({ kind: 'remux', audioTrackId: 2 })
  })

  it('rejects files whose only audio cannot be decoded (TrueHD)', () => {
    expect(decidePlaybackPlan(facts({ audio: [track(2, 'truehd', 'mlpa', true)] }), caps())).toEqual({
      kind: 'unsupported',
      reason: 'audio-codec',
    })
  })

  it('remuxes silent videos without an audio track', () => {
    const plan = decidePlaybackPlan(facts({ audio: [] }), caps({ canPlayNatively: () => false }))
    expect(plan).toEqual({ kind: 'remux', videoTrackId: 1, audioTrackId: null, transcodeAudio: false })
  })

  it('rejects unknown video codecs instead of letting the browser play audio over a blank picture', () => {
    const plan = decidePlaybackPlan(facts({ video: track(1, null, null, true) }), caps({ canPlayNatively: () => true }))
    expect(plan).toEqual({ kind: 'unsupported', reason: 'video-codec' })
  })

  it('rejects video codecs MSE cannot take (HEVC without hardware support)', () => {
    const plan = decidePlaybackPlan(
      facts({ video: track(1, 'hevc', 'hvc1.1.6.L93.B0', true), audio: [track(2, 'ac3', 'ac-3', true)] }),
      caps(),
    )
    expect(plan).toEqual({ kind: 'unsupported', reason: 'video-codec' })
  })

  it('plays HEVC natively where <video> handles it even though MSE does not', () => {
    const hevc = track(1, 'hevc', 'hvc1.1.6.L93.B0', true)
    const plan = decidePlaybackPlan(
      facts({ containerMime: 'video/mp4', video: hevc }),
      caps({ canPlayNatively: (mime) => /hvc1/.test(mime) }),
    )
    expect(plan).toEqual({ kind: 'native' })
  })

  describe('without Media Source Extensions (iPhone Safari)', () => {
    const noMse = (canPlay: (mime: string) => boolean) =>
      caps({ mseAvailable: false, canPlayThroughMse: () => false, canPlayNatively: canPlay })

    it('still plays natively supported files', () => {
      expect(
        decidePlaybackPlan(
          facts(),
          noMse(() => true),
        ),
      ).toEqual({ kind: 'native' })
    })

    it('blames the audio when the video alone would play', () => {
      const plan = decidePlaybackPlan(
        facts({ audio: [track(2, 'ac3', 'ac-3', true)] }),
        noMse((mime) => !/ac-3/.test(mime)),
      )
      expect(plan).toEqual({ kind: 'unsupported', reason: 'audio-codec' })
    })

    it('blames the container when the codecs would play in MP4', () => {
      const plan = decidePlaybackPlan(
        facts(),
        noMse((mime) => mime.startsWith('video/mp4')),
      )
      expect(plan).toEqual({ kind: 'unsupported', reason: 'container' })
    })

    it('blames the video codec when nothing about it plays', () => {
      expect(
        decidePlaybackPlan(
          facts(),
          noMse(() => false),
        ),
      ).toEqual({ kind: 'unsupported', reason: 'video-codec' })
    })
  })
})
