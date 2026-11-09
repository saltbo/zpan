import { ALL_FORMATS, Input, type InputTrack, UnsupportedInputFormatError, UrlSource } from 'mediabunny'
import type { MediaFacts, MediaTrackFacts } from './plan'

/** Opens the file over HTTP range requests; only container metadata is read. */
export function openMediaInput(url: string): Input {
  return new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
}

/** Returns null when the container is not one we can demux (AVI, ASF, RealMedia, ...). */
export async function readMediaFacts(input: Input): Promise<MediaFacts | null> {
  let containerMime: string
  try {
    containerMime = (await input.getFormat()).mimeType
  } catch (error) {
    if (error instanceof UnsupportedInputFormatError) return null
    throw error
  }
  const video = await input.getPrimaryVideoTrack()
  const audio = await input.getAudioTracks()
  return {
    containerMime,
    video: video ? await trackFacts(video) : null,
    audio: await Promise.all(audio.map(trackFacts)),
  }
}

async function trackFacts(track: InputTrack): Promise<MediaTrackFacts> {
  const [codec, codecString, disposition] = await Promise.all([
    track.getCodec(),
    track.getCodecParameterString(),
    track.getDisposition(),
  ])
  return { id: track.id, codec, codecString, isDefault: disposition.default }
}
