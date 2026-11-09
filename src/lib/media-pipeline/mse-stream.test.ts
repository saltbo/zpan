import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Each appended chunk's byte length is the number of seconds of media it carries.
class FakeTimeRanges {
  constructor(private readonly ranges: Array<[number, number]>) {}
  get length() {
    return this.ranges.length
  }
  start(i: number) {
    return this.ranges[i][0]
  }
  end(i: number) {
    return this.ranges[i][1]
  }
}

class FakeSourceBuffer extends EventTarget {
  updating = false
  timestampOffset = 0
  ranges: Array<[number, number]> = []
  appended: number[] = []
  quotaFailures = 0
  aborts = 0
  get buffered() {
    return new FakeTimeRanges(this.ranges)
  }
  appendBuffer(data: Uint8Array) {
    if (this.quotaFailures > 0) {
      this.quotaFailures -= 1
      throw new DOMException('full', 'QuotaExceededError')
    }
    this.updating = true
    const last = this.ranges.at(-1)
    const start = last && last[1] >= this.timestampOffset ? last[1] : this.timestampOffset
    this.appended.push(data.byteLength)
    queueMicrotask(() => {
      if (last && last[1] >= this.timestampOffset) last[1] = start + data.byteLength
      else this.ranges.push([start, start + data.byteLength])
      this.finish()
    })
  }
  remove(start: number, end: number) {
    this.updating = true
    queueMicrotask(() => {
      this.ranges = this.ranges.flatMap(
        ([s, e]): Array<[number, number]> => [
          ...(s < start ? [[s, Math.min(e, start)] as [number, number]] : []),
          ...(e > end ? [[Math.max(s, end), e] as [number, number]] : []),
        ],
      )
      this.finish()
    })
  }
  abort() {
    this.aborts += 1
  }
  private finish() {
    this.updating = false
    this.dispatchEvent(new Event('updateend'))
  }
}

class FakeMediaSource extends EventTarget {
  static instances: FakeMediaSource[] = []
  static isTypeSupported = vi.fn((mime: string) => /mp4a|opus|avc1/.test(mime))
  readyState: 'closed' | 'open' | 'ended' = 'closed'
  duration = Number.NaN
  sourceBuffers: FakeSourceBuffer[] = []
  addedMime: string | null = null
  constructor() {
    super()
    FakeMediaSource.instances.push(this)
  }
  open() {
    this.readyState = 'open'
    this.dispatchEvent(new Event('sourceopen'))
  }
  addSourceBuffer(mime: string) {
    this.addedMime = mime
    const buffer = new FakeSourceBuffer()
    this.sourceBuffers.push(buffer)
    return buffer
  }
  endOfStream() {
    this.readyState = 'ended'
  }
}

interface FakeRun {
  trimStart: number
  write: (seconds: number) => Promise<void>
  finish: () => void
  fail: (error: unknown) => void
  canceled: boolean
  audioOptions: unknown
  otherAudioOptions: unknown
  otherVideoOptions: unknown
}

const runs = vi.hoisted(() => [] as FakeRun[])
const registerAc3Decoder = vi.hoisted(() => vi.fn())
const registerDtsDecoder = vi.hoisted(() => vi.fn())
const getFirstEncodableAudioCodec = vi.hoisted(() => vi.fn(async (codecs: string[]) => codecs[0] ?? null))

vi.mock('@mediabunny/ac3', () => ({ registerAc3Decoder }))
vi.mock('@mediabunny/dts', () => ({ registerDtsDecoder }))

vi.mock('mediabunny', () => {
  class ConversionCanceledError extends Error {}
  class StreamTarget {
    constructor(readonly writable: WritableStream) {}
  }
  class Output {
    constructor(readonly options: { target: StreamTarget }) {}
    getMimeType = async () => 'video/mp4; codecs="avc1.64001f, mp4a.40.2"'
  }
  class Mp4OutputFormat {}
  class EncodedPacketSink {
    getKeyPacket = async (time: number) => ({ timestamp: Math.floor(time / 2) * 2 })
  }
  const Conversion = {
    init: async (options: {
      output: Output
      trim: { start: number }
      audio: (track: { id: number }) => unknown
      video: (track: { id: number }) => unknown
    }) => {
      const writer = options.output.options.target.writable.getWriter()
      let settle: { resolve: () => void; reject: (e: unknown) => void } | null = null
      const run: FakeRun = {
        trimStart: options.trim.start,
        canceled: false,
        write: (seconds) => writer.write({ data: new Uint8Array(seconds), position: 0 }),
        finish: () => settle?.resolve(),
        fail: (error) => settle?.reject(error),
        audioOptions: options.audio({ id: 2 }),
        otherAudioOptions: options.audio({ id: 9 }),
        otherVideoOptions: options.video({ id: 9 }),
      }
      runs.push(run)
      return {
        isValid: true,
        discardedTracks: [],
        execute: () =>
          new Promise<void>((resolve, reject) => {
            settle = { resolve, reject }
          }),
        cancel: async () => {
          run.canceled = true
          settle?.reject(new ConversionCanceledError('canceled'))
        },
      }
    },
  }
  return {
    Conversion,
    ConversionCanceledError,
    EncodedPacketSink,
    getFirstEncodableAudioCodec,
    Mp4OutputFormat,
    Output,
    StreamTarget,
  }
})

const { MseStream, mseConstructor } = await import('./mse-stream')

function fakeInput(audioCodec = 'aac') {
  return {
    getVideoTracks: async () => [{ id: 1 }],
    getAudioTracks: async () => [{ id: 2, getCodec: async () => audioCodec }],
    computeDuration: async () => 300,
  } as never
}

function fakeVideo() {
  const video = new EventTarget() as EventTarget & { currentTime: number; src: string }
  video.currentTime = 0
  video.src = 'blob:http://localhost/stream'
  return video
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function startedStream(options: { transcode?: boolean; audioCodec?: string } = {}) {
  const onError = vi.fn()
  const stream = await MseStream.create(
    fakeInput(options.audioCodec),
    { kind: 'remux', videoTrackId: 1, audioTrackId: 2, transcodeAudio: options.transcode ?? false },
    onError,
  )
  const mediaSource = FakeMediaSource.instances.at(-1) as FakeMediaSource
  const video = fakeVideo()
  stream.attach(video as unknown as HTMLVideoElement)
  mediaSource.open()
  await flush()
  return { stream, mediaSource, video, onError }
}

beforeEach(() => {
  runs.length = 0
  FakeMediaSource.instances = []
  vi.stubGlobal('MediaSource', FakeMediaSource)
  vi.stubGlobal('URL', { ...URL, revokeObjectURL: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('mseConstructor', () => {
  it('returns null when Media Source Extensions are missing', () => {
    vi.stubGlobal('MediaSource', undefined)
    expect(mseConstructor()).toBeNull()
  })
})

describe('MseStream', () => {
  it('copies tracks from the first keyframe into a SourceBuffer and ends the stream', async () => {
    const { mediaSource } = await startedStream()
    const [run] = runs
    expect(run.trimStart).toBe(0)
    expect(run.audioOptions).toEqual({})
    expect(run.otherAudioOptions).toEqual({ discard: true })
    expect(run.otherVideoOptions).toEqual({ discard: true })

    await run.write(5)
    await run.write(5)
    const buffer = mediaSource.sourceBuffers[0]
    expect(mediaSource.addedMime).toBe('video/mp4; codecs="avc1.64001f, mp4a.40.2"')
    expect(mediaSource.duration).toBe(300)
    expect(buffer.ranges).toEqual([[0, 10]])

    run.finish()
    await flush()
    expect(mediaSource.readyState).toBe('ended')
  })

  it('loads the matching WASM decoder and transcodes to an MSE-playable codec', async () => {
    await startedStream({ transcode: true, audioCodec: 'dts' })
    expect(registerDtsDecoder).toHaveBeenCalledOnce()
    expect(getFirstEncodableAudioCodec).toHaveBeenCalledWith(['aac', 'opus'], {
      numberOfChannels: 2,
      sampleRate: 48000,
    })
    expect(runs[0].audioOptions).toEqual({ codec: 'aac', numberOfChannels: 2, forceTranscode: true })
  })

  it('uses the AC-3 extension for E-AC-3 too', async () => {
    await startedStream({ transcode: true, audioCodec: 'eac3' })
    expect(registerAc3Decoder).toHaveBeenCalledOnce()
  })

  it('fails creation when no audio codec can be encoded for MSE', async () => {
    getFirstEncodableAudioCodec.mockResolvedValueOnce(null as never)
    await expect(
      MseStream.create(
        fakeInput('ac3'),
        { kind: 'remux', videoTrackId: 1, audioTrackId: 2, transcodeAudio: true },
        vi.fn(),
      ),
    ).rejects.toThrow('No audio codec can be encoded')
  })

  it('pauses writing once 30 s are buffered ahead and resumes as playback advances', async () => {
    const { mediaSource, video } = await startedStream()
    const run = runs[0]
    await run.write(31)
    let written = false
    const pending = run.write(5).then(() => {
      written = true
    })
    await flush()
    expect(written).toBe(false)

    video.currentTime = 10
    video.dispatchEvent(new Event('timeupdate'))
    await pending
    expect(mediaSource.sourceBuffers[0].appended).toEqual([31, 5])
  })

  it('restarts from the keyframe before an unbuffered seek target and ignores the stale run', async () => {
    const { mediaSource, video } = await startedStream()
    const first = runs[0]
    await first.write(10)

    video.currentTime = 201
    video.dispatchEvent(new Event('seeking'))
    await flush()
    await flush()

    expect(first.canceled).toBe(true)
    const second = runs[1]
    expect(second.trimStart).toBe(200)
    const buffer = mediaSource.sourceBuffers[0]
    expect(buffer.timestampOffset).toBe(200)
    expect(buffer.ranges).toEqual([])

    await first.write(5)
    await second.write(4)
    expect(buffer.appended).toEqual([10, 4])
    expect(buffer.ranges).toEqual([[200, 204]])
  })

  it('does not restart for seeks inside the buffered range', async () => {
    const { video } = await startedStream()
    await runs[0].write(20)
    video.currentTime = 12
    video.dispatchEvent(new Event('seeking'))
    await flush()
    expect(runs).toHaveLength(1)
  })

  it('evicts played media when the SourceBuffer runs out of quota', async () => {
    const { mediaSource, video } = await startedStream()
    const run = runs[0]
    await run.write(20)
    video.currentTime = 15
    const buffer = mediaSource.sourceBuffers[0]
    buffer.quotaFailures = 1
    await run.write(5)
    expect(buffer.ranges[0][0]).toBeGreaterThan(0)
    expect(buffer.appended).toEqual([20, 5])
  })

  it('reports conversion failures', async () => {
    const { onError } = await startedStream()
    const error = new Error('decode failed')
    runs[0].fail(error)
    await flush()
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('cancels work, drops late writes and revokes the object URL on dispose', async () => {
    const { stream, mediaSource, onError } = await startedStream()
    const run = runs[0]
    stream.dispose()
    await flush()
    expect(run.canceled).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/stream')
    await run.write(5)
    expect(mediaSource.sourceBuffers).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
  })
})
