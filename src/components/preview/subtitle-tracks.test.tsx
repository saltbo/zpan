import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubtitleSource } from '@/lib/subtitles'
import { SubtitleTracks } from './subtitle-tracks'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh' } }) }))

type Listener = () => void

const { FakeTextTrack } = vi.hoisted(() => {
  class FakeTextTrack {
    mode: 'disabled' | 'showing' = 'disabled'
    cues: unknown[] = []
    listeners = new Set<Listener>()
    constructor(readonly init: Record<string, unknown>) {
      if (init.default) this.mode = 'showing'
    }
    addCue(cue: unknown) {
      this.cues.push(cue)
    }
    addEventListener(_type: 'mode-change', listener: Listener) {
      this.listeners.add(listener)
    }
    removeEventListener(_type: 'mode-change', listener: Listener) {
      this.listeners.delete(listener)
    }
    show() {
      this.mode = 'showing'
      for (const listener of [...this.listeners]) listener()
    }
  }
  return { FakeTextTrack }
})
type FakeTextTrack = InstanceType<typeof FakeTextTrack>

const player = vi.hoisted(() => ({
  currentTime: 42,
  textTracks: { add: vi.fn(), remove: vi.fn() },
}))

vi.mock('@vidstack/react', () => ({
  TextTrack: FakeTextTrack,
  useMediaPlayer: () => player,
}))

const subtitles = vi.hoisted(() => ({
  loadSubtitleSources: vi.fn(),
  streamEmbeddedCues: vi.fn(),
}))
vi.mock('@/lib/subtitles', () => subtitles)

class TestVTTCue {
  constructor(
    readonly startTime: number,
    readonly endTime: number,
    readonly text: string,
  ) {}
}

const embedded = (id: string, isDefault: boolean) =>
  ({
    kind: 'embedded',
    id,
    label: id,
    language: 'en',
    isDefault,
    isForced: false,
    file: {},
    track: { number: 1 },
  }) as unknown as SubtitleSource

const sidecars = [{ name: 'Movie.chs.srt', url: 'https://s3/Movie.chs.srt', format: 'srt' as const, tag: 'chs' }]

function added() {
  return player.textTracks.add.mock.calls.map(([track]) => track as FakeTextTrack)
}

beforeEach(() => {
  vi.stubGlobal('VTTCue', TestVTTCue)
  subtitles.streamEmbeddedCues.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('SubtitleTracks', () => {
  it('adds a parsed track for each sidecar file and removes them on close', async () => {
    subtitles.loadSubtitleSources.mockResolvedValue([
      {
        kind: 'file',
        id: 'file:Movie.chs.srt',
        label: '简体中文',
        language: 'zh-Hans',
        isDefault: true,
        isForced: false,
        format: 'srt',
        content: 'SRT',
      },
      {
        kind: 'file',
        id: 'file:Movie.srt',
        label: 'Movie.srt',
        language: null,
        isDefault: false,
        isForced: false,
        format: 'ass',
        content: 'ASS',
      },
    ])
    const { unmount } = render(
      <SubtitleTracks videoUrl="https://s3/Movie.mkv" videoName="Movie.mkv" sidecars={sidecars} />,
    )

    await waitFor(() => expect(player.textTracks.add).toHaveBeenCalledTimes(2))
    expect(subtitles.loadSubtitleSources).toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: 'https://s3/Movie.mkv', videoName: 'Movie.mkv', sidecars, uiLanguage: 'zh' }),
    )
    expect(added().map((track) => track.init)).toEqual([
      {
        id: 'file:Movie.chs.srt',
        kind: 'subtitles',
        label: '简体中文',
        language: 'zh-Hans',
        default: true,
        type: 'srt',
        content: 'SRT',
      },
      {
        id: 'file:Movie.srt',
        kind: 'subtitles',
        label: 'Movie.srt',
        language: undefined,
        default: false,
        type: 'ass',
        content: 'ASS',
      },
    ])

    unmount()
    expect(player.textTracks.remove.mock.calls.map(([track]) => track)).toEqual(added())
  })

  it('streams an embedded track as soon as it is shown, from the playhead', async () => {
    subtitles.streamEmbeddedCues.mockImplementation(async ({ currentTime, onCue }) => {
      onCue({ start: currentTime(), end: currentTime() + 2, text: 'line' })
    })
    subtitles.loadSubtitleSources.mockResolvedValue([embedded('embedded:1', true), embedded('embedded:2', false)])
    render(<SubtitleTracks videoUrl="https://s3/Movie.mkv" videoName="Movie.mkv" sidecars={[]} />)

    await waitFor(() => expect(player.textTracks.add).toHaveBeenCalledTimes(2))
    const [shown, hidden] = added()
    expect(shown.init).toMatchObject({ type: 'vtt', default: true })
    expect(shown.init).not.toHaveProperty('content')
    expect(shown.cues).toEqual([new TestVTTCue(42, 44, 'line')])
    expect(subtitles.streamEmbeddedCues).toHaveBeenCalledOnce()

    hidden.show()
    hidden.show()
    expect(subtitles.streamEmbeddedCues).toHaveBeenCalledTimes(2)
    expect(hidden.cues).toHaveLength(1)
  })

  it('reports a failed stream without breaking playback', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    subtitles.streamEmbeddedCues.mockRejectedValue(new Error('expired'))
    subtitles.loadSubtitleSources.mockResolvedValue([embedded('embedded:1', true)])
    render(<SubtitleTracks videoUrl="https://s3/Movie.mkv" videoName="Movie.mkv" sidecars={[]} />)

    await waitFor(() =>
      expect(errors).toHaveBeenCalledWith('Failed to stream subtitle track embedded:1', expect.any(Error)),
    )
  })

  it('drops sources that finish loading after the preview closed', async () => {
    let resolve: (sources: SubtitleSource[]) => void = () => {}
    subtitles.loadSubtitleSources.mockReturnValue(new Promise((r) => (resolve = r)))
    const { unmount } = render(<SubtitleTracks videoUrl="https://s3/Movie.mkv" videoName="Movie.mkv" sidecars={[]} />)
    unmount()

    resolve([embedded('embedded:1', true)])
    await Promise.resolve()
    expect(player.textTracks.add).not.toHaveBeenCalled()
  })
})
