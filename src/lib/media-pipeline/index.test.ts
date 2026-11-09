import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaFacts, PlaybackCapabilities } from './plan'

const dispose = vi.hoisted(() => vi.fn())
const readMediaFacts = vi.hoisted(() => vi.fn<() => Promise<MediaFacts | null>>())
const decidePlaybackPlan = vi.hoisted(() => vi.fn())
const createStream = vi.hoisted(() => vi.fn())

vi.mock('./probe', () => ({
  openMediaInput: () => ({ dispose }),
  readMediaFacts,
}))
vi.mock('./plan', () => ({ decidePlaybackPlan }))
vi.mock('./mse-stream', () => ({
  MseStream: { create: createStream },
  mseConstructor: () => (globalThis as { MediaSource?: unknown }).MediaSource ?? null,
  SOFT_DECODABLE_AUDIO: new Set(['ac3']),
}))

const { preparePlayback } = await import('./index')

const FACTS: MediaFacts = { containerMime: 'video/x-matroska', video: null, audio: [] }

beforeEach(() => {
  readMediaFacts.mockResolvedValue(FACTS)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('preparePlayback', () => {
  it('rejects containers that cannot be demuxed', async () => {
    readMediaFacts.mockResolvedValue(null)
    const prepared = await preparePlayback('https://s3/x.avi', vi.fn())
    expect(prepared).toMatchObject({ kind: 'unsupported', reason: 'container' })
    prepared.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('returns native playback and passes real browser capabilities to the plan', async () => {
    const isTypeSupported = vi.fn(() => true)
    vi.stubGlobal('MediaSource', { isTypeSupported })
    decidePlaybackPlan.mockReturnValue({ kind: 'native' })

    const prepared = await preparePlayback('https://s3/x.mp4', vi.fn())
    expect(prepared.kind).toBe('native')

    const [facts, caps] = decidePlaybackPlan.mock.calls[0] as [MediaFacts, PlaybackCapabilities]
    expect(facts).toBe(FACTS)
    expect(caps.mseAvailable).toBe(true)
    expect(caps.canPlayThroughMse('video/mp4; codecs="avc1"')).toBe(true)
    expect(isTypeSupported).toHaveBeenCalledWith('video/mp4; codecs="avc1"')
    expect(typeof caps.canPlayNatively('video/mp4')).toBe('boolean')
    expect(caps.softDecodableAudio.has('ac3')).toBe(true)
  })

  it('reports MSE as unavailable when the browser lacks it', async () => {
    vi.stubGlobal('MediaSource', undefined)
    decidePlaybackPlan.mockReturnValue({ kind: 'native' })
    await preparePlayback('https://s3/x.mp4', vi.fn())
    const [, caps] = decidePlaybackPlan.mock.calls[0] as [MediaFacts, PlaybackCapabilities]
    expect(caps.mseAvailable).toBe(false)
    expect(caps.canPlayThroughMse('video/mp4')).toBe(false)
  })

  it('passes unsupported plans through', async () => {
    decidePlaybackPlan.mockReturnValue({ kind: 'unsupported', reason: 'audio-codec' })
    await expect(preparePlayback('https://s3/x.mkv', vi.fn())).resolves.toMatchObject({
      kind: 'unsupported',
      reason: 'audio-codec',
    })
  })

  it('creates a Media Source stream for remux plans and disposes both on release', async () => {
    const plan = { kind: 'remux', videoTrackId: 1, audioTrackId: 2, transcodeAudio: true }
    const stream = { dispose: vi.fn() }
    const onError = vi.fn()
    decidePlaybackPlan.mockReturnValue(plan)
    createStream.mockResolvedValue(stream)

    const prepared = await preparePlayback('https://s3/x.mkv', onError)
    expect(prepared).toMatchObject({ kind: 'mse', stream })
    expect(createStream).toHaveBeenCalledWith(expect.objectContaining({ dispose }), plan, onError)

    prepared.dispose()
    expect(stream.dispose).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('reports the audio as unplayable when preparing the transcode fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    decidePlaybackPlan.mockReturnValue({ kind: 'remux', videoTrackId: 1, audioTrackId: 2, transcodeAudio: true })
    createStream.mockRejectedValue(new Error('No audio codec can be encoded'))
    await expect(preparePlayback('https://s3/x.mkv', vi.fn())).resolves.toMatchObject({
      kind: 'unsupported',
      reason: 'audio-codec',
    })
  })

  it('releases the input and rethrows when the probe fails', async () => {
    readMediaFacts.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(preparePlayback('https://s3/x.mkv', vi.fn())).rejects.toThrow('Failed to fetch')
    expect(dispose).toHaveBeenCalledOnce()
  })
})
