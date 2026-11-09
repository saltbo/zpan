import { MseStream, mseConstructor, SOFT_DECODABLE_AUDIO } from './mse-stream'
import { decidePlaybackPlan, type PlaybackCapabilities, type UnsupportedReason } from './plan'
import { openMediaInput, readMediaFacts } from './probe'

export type { UnsupportedReason } from './plan'

export type PreparedPlayback =
  | { kind: 'native'; dispose: () => void }
  | { kind: 'mse'; stream: MseStream; dispose: () => void }
  | { kind: 'unsupported'; reason: UnsupportedReason; dispose: () => void }

/**
 * Inspects the file's container and codecs (range-reading only metadata) and prepares the cheapest way to play
 * it: the URL as-is, a Media Source stream with remuxed/transcoded audio, or nothing at all.
 */
export async function preparePlayback(url: string, onStreamError: (error: unknown) => void): Promise<PreparedPlayback> {
  const input = openMediaInput(url)
  const release = () => input.dispose()
  try {
    const facts = await readMediaFacts(input)
    if (!facts) return { kind: 'unsupported', reason: 'container', dispose: release }
    const plan = decidePlaybackPlan(facts, browserCapabilities())
    if (plan.kind === 'native') return { kind: 'native', dispose: release }
    if (plan.kind === 'unsupported') return { kind: 'unsupported', reason: plan.reason, dispose: release }
    let stream: MseStream
    try {
      stream = await MseStream.create(input, plan, onStreamError)
    } catch (error) {
      // Native playback would drop the audio silently, which is exactly what this pipeline exists to prevent.
      console.error('Preparing the audio transcode failed', error)
      return { kind: 'unsupported', reason: 'audio-codec', dispose: release }
    }
    return {
      kind: 'mse',
      stream,
      dispose: () => {
        stream.dispose()
        release()
      },
    }
  } catch (error) {
    release()
    throw error
  }
}

function browserCapabilities(): PlaybackCapabilities {
  const probe = document.createElement('video')
  const MediaSourceImpl = mseConstructor()
  return {
    canPlayNatively: (mime) => probe.canPlayType(mime) !== '',
    mseAvailable: MediaSourceImpl !== null,
    canPlayThroughMse: (mime) => MediaSourceImpl?.isTypeSupported(mime) ?? false,
    softDecodableAudio: SOFT_DECODABLE_AUDIO,
  }
}
