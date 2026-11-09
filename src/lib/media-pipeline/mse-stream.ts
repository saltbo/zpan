import {
  type AudioCodec,
  Conversion,
  ConversionCanceledError,
  EncodedPacketSink,
  getFirstEncodableAudioCodec,
  type Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny'
import type { PlaybackPlan } from './plan'

type RemuxPlan = Extract<PlaybackPlan, { kind: 'remux' }>

// Chrome's MSE quota is ~150 MB per video SourceBuffer; 30 s keeps high-bitrate remuxes well inside it.
const BUFFER_AHEAD_SECONDS = 30
const BUFFER_BEHIND_SECONDS = 10
// Backpressure is checked per written chunk, so chunks must stay small relative to the look-ahead window.
const STREAM_CHUNK_BYTES = 512 * 1024
// Copied audio frames rarely land exactly on the video keyframe a run starts from.
const COPY_SHIFT_TOLERANCE_SECONDS = 0.25

const DECODER_LOADERS: Record<string, () => Promise<void>> = {
  ac3: () => import('@mediabunny/ac3').then((m) => m.registerAc3Decoder()),
  eac3: () => import('@mediabunny/ac3').then((m) => m.registerAc3Decoder()),
  dts: () => import('@mediabunny/dts').then((m) => m.registerDtsDecoder()),
}

const MSE_AUDIO_CODEC_STRINGS: Partial<Record<AudioCodec, string>> = { aac: 'mp4a.40.2', opus: 'opus' }

/** Codecs that can be decoded in the browser: WASM extensions plus what WebCodecs and Mediabunny handle. */
export const SOFT_DECODABLE_AUDIO: ReadonlySet<string> = new Set([
  ...Object.keys(DECODER_LOADERS),
  'aac',
  'opus',
  'mp3',
  'vorbis',
  'flac',
  'pcm-s16',
  'pcm-s16be',
  'pcm-s24',
  'pcm-s24be',
  'pcm-s32',
  'pcm-s32be',
  'pcm-f32',
  'pcm-f32be',
  'pcm-u8',
  'pcm-s8',
  'ulaw',
  'alaw',
])

export function mseConstructor(): typeof MediaSource | null {
  return typeof MediaSource === 'undefined' ? null : MediaSource
}

/**
 * Remuxes (and, when needed, transcodes the audio of) a media file into fragmented MP4 fed through
 * Media Source Extensions, so the browser's own <video> plays it with native seeking and controls.
 */
export class MseStream {
  /** Hand this to the player; Vidstack creates (and the stream revokes) the object URL. */
  readonly mediaSource: MediaSource
  private readonly opened: Promise<void>
  private sourceBuffer: SourceBuffer | null = null
  private video: HTMLVideoElement | null = null
  private conversion: Conversion | null = null
  private generation = 0
  // timestampOffset to apply once the SourceBuffer exists (it is created from the first run's MIME type).
  private pendingOffset = 0
  private wake: () => void = () => {}
  private disposed = false

  private constructor(
    private readonly input: Input,
    private readonly plan: RemuxPlan,
    private readonly audioCodec: AudioCodec | null,
    private readonly keyPackets: EncodedPacketSink,
    private readonly onError: (error: unknown) => void,
  ) {
    const MediaSourceImpl = mseConstructor()
    if (!MediaSourceImpl) throw new Error('Media Source Extensions are unavailable')
    this.mediaSource = new MediaSourceImpl()
    this.opened = new Promise((resolve) =>
      this.mediaSource.addEventListener('sourceopen', () => resolve(), { once: true }),
    )
  }

  static async create(input: Input, plan: RemuxPlan, onError: (error: unknown) => void): Promise<MseStream> {
    const videoTrack = (await input.getVideoTracks()).find((track) => track.id === plan.videoTrackId)
    if (!videoTrack) throw new Error('Video track disappeared from the input')
    let audioCodec: AudioCodec | null = null
    if (plan.transcodeAudio) {
      const audioTrack = (await input.getAudioTracks()).find((track) => track.id === plan.audioTrackId)
      const codec = await audioTrack?.getCodec()
      if (codec) await DECODER_LOADERS[codec]?.()
      audioCodec = await pickMseAudioCodec()
    }
    return new MseStream(input, plan, audioCodec, new EncodedPacketSink(videoTrack), onError)
  }

  attach(video: HTMLVideoElement): void {
    if (this.video === video) return
    this.detach()
    this.video = video
    video.addEventListener('seeking', this.handleSeeking)
    video.addEventListener('timeupdate', this.handleProgress)
    void this.start(0)
  }

  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.wake()
    void this.conversion?.cancel().catch(() => {})
    if (this.video?.src.startsWith('blob:')) URL.revokeObjectURL(this.video.src)
    this.detach()
  }

  private detach(): void {
    this.video?.removeEventListener('seeking', this.handleSeeking)
    this.video?.removeEventListener('timeupdate', this.handleProgress)
  }

  private readonly handleSeeking = () => {
    const time = this.video?.currentTime ?? 0
    if (!this.isBuffered(time)) void this.start(time)
  }

  private readonly handleProgress = () => this.wake()

  private async start(time: number): Promise<void> {
    const generation = ++this.generation
    this.wake()
    try {
      await this.conversion?.cancel()
      await this.opened
      if (generation !== this.generation) return
      const startTime = (await this.keyPackets.getKeyPacket(time))?.timestamp ?? 0
      if (generation !== this.generation) return
      await this.resetBuffer(startTime)
      await this.run(generation, startTime)
    } catch (error) {
      if (error instanceof ConversionCanceledError || generation !== this.generation || this.disposed) return
      this.onError(error)
    }
  }

  private async run(generation: number, startTime: number): Promise<void> {
    const output: Output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'fragmented' }),
      target: new StreamTarget(
        this.writer(generation, () => output),
        { chunked: true, chunkSize: STREAM_CHUNK_BYTES },
      ),
    })
    const conversion = await Conversion.init({
      input: this.input,
      output,
      showWarnings: false,
      video: (track) => (track.id === this.plan.videoTrackId ? {} : { discard: true }),
      audio: (track) => {
        if (track.id !== this.plan.audioTrackId) return { discard: true }
        return this.audioCodec ? { codec: this.audioCodec, numberOfChannels: 2, forceTranscode: true } : {}
      },
      trim: { start: startTime },
      copy: { shiftTolerance: COPY_SHIFT_TOLERANCE_SECONDS },
    })
    if (!conversion.isValid) {
      throw new Error(`Cannot convert media: ${conversion.discardedTracks.map((t) => t.reason).join(', ')}`)
    }
    if (generation !== this.generation) return
    this.conversion = conversion
    await conversion.execute()
    if (generation !== this.generation) return
    await this.idle()
    if (this.mediaSource.readyState === 'open') this.mediaSource.endOfStream()
  }

  private writer(generation: number, output: () => Output): WritableStream<StreamTargetChunk> {
    return new WritableStream({
      write: async ({ data }) => {
        if (generation !== this.generation) return
        const sourceBuffer = await this.ensureSourceBuffer(output())
        await this.waitForRoom(generation)
        if (generation !== this.generation) return
        await this.append(sourceBuffer, data)
      },
    })
  }

  private async ensureSourceBuffer(output: Output): Promise<SourceBuffer> {
    if (this.sourceBuffer) return this.sourceBuffer
    const mime = await output.getMimeType()
    this.sourceBuffer = this.mediaSource.addSourceBuffer(mime)
    this.mediaSource.duration = await this.input.computeDuration()
    this.sourceBuffer.timestampOffset = this.pendingOffset
    return this.sourceBuffer
  }

  private async resetBuffer(startTime: number): Promise<void> {
    const sourceBuffer = this.sourceBuffer
    if (!sourceBuffer) {
      this.pendingOffset = startTime
      return
    }
    await this.idle()
    if (this.mediaSource.readyState === 'open') sourceBuffer.abort()
    if (sourceBuffer.buffered.length > 0) {
      sourceBuffer.remove(0, Number.POSITIVE_INFINITY)
      await updateEnd(sourceBuffer)
    }
    sourceBuffer.timestampOffset = startTime
  }

  private async append(sourceBuffer: SourceBuffer, data: Uint8Array): Promise<void> {
    for (;;) {
      try {
        await this.idle()
        sourceBuffer.appendBuffer(data as Uint8Array<ArrayBuffer>)
        await updateEnd(sourceBuffer)
        await this.evictBehind(BUFFER_BEHIND_SECONDS)
        return
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'QuotaExceededError')) throw error
        if (!(await this.evictBehind(2))) await this.nextWake()
      }
    }
  }

  private async waitForRoom(generation: number): Promise<void> {
    while (generation === this.generation && this.bufferedAhead() > BUFFER_AHEAD_SECONDS) {
      await this.nextWake()
    }
  }

  private async evictBehind(keepSeconds: number): Promise<boolean> {
    const sourceBuffer = this.sourceBuffer
    const time = this.video?.currentTime ?? 0
    if (!sourceBuffer || sourceBuffer.buffered.length === 0) return false
    const start = sourceBuffer.buffered.start(0)
    if (time - keepSeconds <= start) return false
    sourceBuffer.remove(start, time - keepSeconds)
    await updateEnd(sourceBuffer)
    return true
  }

  private bufferedAhead(): number {
    const time = this.video?.currentTime ?? 0
    const buffered = this.sourceBuffer?.buffered
    if (!buffered) return 0
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= time && time < buffered.end(i)) return buffered.end(i) - time
    }
    return 0
  }

  private isBuffered(time: number): boolean {
    const buffered = this.sourceBuffer?.buffered
    if (!buffered) return false
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= time && time < buffered.end(i)) return true
    }
    return false
  }

  private nextWake(): Promise<void> {
    return new Promise((resolve) => {
      const previous = this.wake
      this.wake = () => {
        previous()
        resolve()
      }
    })
  }

  private async idle(): Promise<void> {
    if (this.sourceBuffer?.updating) await updateEnd(this.sourceBuffer)
  }
}

async function pickMseAudioCodec(): Promise<AudioCodec> {
  const MediaSourceImpl = mseConstructor()
  const candidates = (Object.keys(MSE_AUDIO_CODEC_STRINGS) as AudioCodec[]).filter((codec) =>
    MediaSourceImpl?.isTypeSupported(`audio/mp4; codecs="${MSE_AUDIO_CODEC_STRINGS[codec]}"`),
  )
  const codec = await getFirstEncodableAudioCodec(candidates, { numberOfChannels: 2, sampleRate: 48000 })
  if (!codec) throw new Error('No audio codec can be encoded for Media Source playback')
  return codec
}

function updateEnd(sourceBuffer: SourceBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      sourceBuffer.removeEventListener('error', fail)
      resolve()
    }
    const fail = () => {
      sourceBuffer.removeEventListener('updateend', done)
      reject(new Error('SourceBuffer update failed'))
    }
    sourceBuffer.addEventListener('updateend', done, { once: true })
    sourceBuffer.addEventListener('error', fail, { once: true })
  })
}
