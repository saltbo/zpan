export interface MediaTrackFacts {
  id: number
  codec: string | null
  codecString: string | null
  isDefault: boolean
}

export interface MediaFacts {
  containerMime: string
  video: MediaTrackFacts | null
  audio: MediaTrackFacts[]
}

export interface PlaybackCapabilities {
  /** `<video>.canPlayType` answered "maybe" or "probably". */
  canPlayNatively: (mime: string) => boolean
  /** Media Source Extensions exist (iPhone Safari only has ManagedMediaSource). */
  mseAvailable: boolean
  /** MSE accepts this fragmented-MP4 type. */
  canPlayThroughMse: (mime: string) => boolean
  /** Audio codecs we can decode in software and re-encode for MSE. */
  softDecodableAudio: ReadonlySet<string>
}

export type UnsupportedReason = 'container' | 'video-codec' | 'audio-codec'

export type PlaybackPlan =
  | { kind: 'native' }
  | { kind: 'remux'; videoTrackId: number; audioTrackId: number | null; transcodeAudio: boolean }
  | { kind: 'unsupported'; reason: UnsupportedReason }

const mp4Type = (kind: 'video' | 'audio', codecString: string) => `${kind}/mp4; codecs="${codecString}"`
const unsupported = (reason: UnsupportedReason): PlaybackPlan => ({ kind: 'unsupported', reason })

export function decidePlaybackPlan(facts: MediaFacts, caps: PlaybackCapabilities): PlaybackPlan {
  const { video } = facts
  const primaryAudio = facts.audio.find((track) => track.isDefault) ?? facts.audio[0] ?? null
  // Unknown codecs (codecString null) are never handed to the browser: Chromium may play MKV audio with no picture.
  if (!video?.codecString) return unsupported('video-codec')
  if (caps.canPlayNatively(fullMime(facts.containerMime, [video, primaryAudio]))) return { kind: 'native' }

  if (!caps.mseAvailable) {
    if (caps.canPlayNatively(fullMime(facts.containerMime, [video]))) return unsupported('audio-codec')
    return unsupported(caps.canPlayNatively(mp4Type('video', video.codecString)) ? 'container' : 'video-codec')
  }
  if (!caps.canPlayThroughMse(mp4Type('video', video.codecString))) return unsupported('video-codec')
  if (!primaryAudio) return { kind: 'remux', videoTrackId: video.id, audioTrackId: null, transcodeAudio: false }

  const copyable = (track: MediaTrackFacts) =>
    track.codecString !== null && caps.canPlayThroughMse(mp4Type('audio', track.codecString))
  const decodable = (track: MediaTrackFacts) => track.codec !== null && caps.softDecodableAudio.has(track.codec)
  // The default track wins even when it needs transcoding; other tracks are fallbacks for an undecodable default.
  const candidates = [primaryAudio, ...facts.audio.filter((track) => track !== primaryAudio)]
  const audio = candidates.find((track) => copyable(track) || decodable(track))
  if (!audio) return unsupported('audio-codec')

  return { kind: 'remux', videoTrackId: video.id, audioTrackId: audio.id, transcodeAudio: !copyable(audio) }
}

function fullMime(containerMime: string, tracks: Array<MediaTrackFacts | null>): string {
  const codecs = tracks.map((track) => track?.codecString).filter(Boolean)
  return codecs.length ? `${containerMime}; codecs="${codecs.join(', ')}"` : containerMime
}
