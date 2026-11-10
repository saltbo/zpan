import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  httpRangeReader,
  loadSubtitleSources,
  type SidecarSubtitle,
  type SubtitleCue,
  type SubtitleSource,
  streamEmbeddedCues,
} from '.'
import type { MkvSubtitleFile } from './mkv'

const VIDEO_URL = 'https://s3.example.com/Movie.mkv?sig=1'
const mkv = new Uint8Array(readFileSync(join(process.cwd(), 'src/lib/subtitles/__fixtures__/mkvmerge.mkv')))
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHi\n'

function serve(files: Record<string, Uint8Array | number>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = files[String(input)]
    if (body === undefined) return new Response(null, { status: 404 })
    if (typeof body === 'number') return new Response(null, { status: body })
    const range = new Headers(init?.headers).get('Range')
    if (!range) return new Response(body as Uint8Array<ArrayBuffer>)
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range) ?? []
    if (Number(start) >= body.length) return new Response(null, { status: 416 })
    return new Response(body.slice(Number(start), Number(end) + 1), { status: 206 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const text = (value: string) => new TextEncoder().encode(value)

const sidecar = (name: string, tag: string): SidecarSubtitle => ({
  name,
  url: `https://s3/${name}`,
  format: 'srt',
  tag,
})

function load(sidecars: SidecarSubtitle[], videoName = 'Movie.mkv', uiLanguage = 'zh') {
  return loadSubtitleSources({
    videoUrl: VIDEO_URL,
    videoName,
    sidecars,
    uiLanguage,
    signal: new AbortController().signal,
  })
}

const summary = (sources: SubtitleSource[]) =>
  sources.map(({ kind, id, label, language, isDefault }) => ({ kind, id, label, language, isDefault }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('loadSubtitleSources', () => {
  it('offers sidecar files first, then the Matroska text tracks, with one default', async () => {
    serve({
      [VIDEO_URL]: mkv,
      'https://s3/Movie.chs.srt': text(SRT),
      'https://s3/Movie.srt': text(SRT),
      'https://s3/Subs/4_English_SDH.srt': text(SRT),
    })
    const sources = await load([
      sidecar('Movie.chs.srt', 'chs'),
      sidecar('Movie.srt', ''),
      sidecar('Subs/4_English_SDH.srt', '4_English_SDH'),
    ])
    expect(summary(sources)).toEqual([
      { kind: 'file', id: 'file:Movie.chs.srt', label: '简体中文', language: 'zh-Hans', isDefault: true },
      { kind: 'file', id: 'file:Movie.srt', label: 'Movie.srt', language: null, isDefault: false },
      { kind: 'file', id: 'file:Subs/4_English_SDH.srt', label: '英语', language: 'en', isDefault: false },
      { kind: 'embedded', id: 'embedded:2', label: '简体中文 (2)', language: 'zh-Hans', isDefault: false },
      { kind: 'embedded', id: 'embedded:3', label: '英语 (2)', language: 'en', isDefault: false },
      { kind: 'embedded', id: 'embedded:4', label: '日语', language: 'ja', isDefault: false },
    ])
    expect(sources[0]).toMatchObject({ format: 'srt', content: SRT })
  })

  it('falls back to the file’s default track when none matches the interface language', async () => {
    serve({ [VIDEO_URL]: mkv })
    const sources = await load([], 'Movie.mkv', 'fr')
    expect(sources.filter((source) => source.isDefault).map((source) => source.id)).toEqual(['embedded:3'])
  })

  it('skips sidecars that fail to load and files that are not Matroska', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = serve({ 'https://s3/Movie.srt': 500 })
    const sources = await load([sidecar('Movie.srt', '')], 'Movie.mp4')
    expect(sources).toEqual([])
    expect(errors).toHaveBeenCalledWith('Failed to load subtitle Movie.srt', expect.any(Error))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves embedded tracks out when the storage ignores range requests', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(mkv as Uint8Array<ArrayBuffer>, { status: 200 })),
    )
    expect(await load([])).toEqual([])
    expect(errors).toHaveBeenCalledWith('Failed to read embedded subtitles', expect.any(Error))
  })
})

describe('httpRangeReader', () => {
  it('requests an inclusive byte range and treats 416 as the end of the file', async () => {
    const fetchMock = serve({ [VIDEO_URL]: text('abcdef') })
    const read = httpRangeReader(VIDEO_URL, new AbortController().signal)
    expect(new TextDecoder().decode(await read(2, 3))).toBe('cde')
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Range')).toBe('bytes=2-4')
    expect(await read(10, 4)).toEqual(new Uint8Array())
  })
})

describe('streamEmbeddedCues', () => {
  async function embeddedSource(trackId: string) {
    serve({ [VIDEO_URL]: mkv })
    const sources = await load([])
    const source = sources.find((candidate) => candidate.id === trackId)
    if (source?.kind !== 'embedded') throw new Error('expected an embedded track')
    return source
  }

  it('delivers every cue as WebVTT text', async () => {
    const source = await embeddedSource('embedded:2')
    const cues: SubtitleCue[] = []
    await streamEmbeddedCues({
      file: source.file,
      track: source.track,
      currentTime: () => 20,
      onCue: (cue) => cues.push(cue),
      signal: new AbortController().signal,
    })
    expect(cues.map((cue) => cue.text).sort()).toEqual(
      ['第一句 <i>斜体</i> 红', '第三句 &amp; 符号', '第二句\n两行'].sort(),
    )
  })

  it('drops cues with nothing to display and stops when aborted', async () => {
    const source = await embeddedSource('embedded:4')
    const cues: SubtitleCue[] = []
    await streamEmbeddedCues({
      file: source.file,
      track: source.track,
      currentTime: () => 0,
      onCue: (cue) => cues.push(cue),
      signal: new AbortController().signal,
    })
    // The vector drawing event has no text.
    expect(cues).toHaveLength(2)

    const controller = new AbortController()
    controller.abort()
    const none: SubtitleCue[] = []
    await streamEmbeddedCues({
      file: source.file,
      track: source.track,
      currentTime: () => 0,
      onCue: (cue) => none.push(cue),
      signal: controller.signal,
    })
    expect(none).toEqual([])
  })

  it('fetches the blocks nearest the playhead first and re-prioritizes after a seek', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      start: i * 10,
      duration: 2,
      clusterOffset: 0,
      relativePosition: i,
    }))
    const track = {
      number: 1,
      format: 'srt' as const,
      language: null,
      name: null,
      isDefault: true,
      isForced: false,
      entries,
    }
    const requested: number[] = []
    let time = 100
    const file = {
      readBlock: async (_track: unknown, entry: (typeof entries)[number]) => {
        requested.push(entry.start)
        if (requested.length === 4) time = 0
        return { start: entry.start, end: entry.start + 2, payload: `at ${entry.start}` }
      },
    } as unknown as MkvSubtitleFile
    await streamEmbeddedCues({
      file,
      track,
      currentTime: () => time,
      onCue: () => {},
      signal: new AbortController().signal,
    })
    expect(requested.slice(0, 4)).toEqual([90, 100, 110, 120])
    expect(requested.slice(4, 8)).toEqual([0, 10, 20, 30])
    expect(requested).toHaveLength(20)
  })
})
