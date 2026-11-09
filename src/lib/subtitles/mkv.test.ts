import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MkvSubtitleFile, type RangeReader } from './mkv'

// Tiny videos with three subtitle tracks (Chinese SRT, English SRT, Japanese ASS), muxed by ffmpeg
// and by mkvmerge (which also zlib-compresses the English track).
const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(process.cwd(), 'src/lib/subtitles/__fixtures__', name)))

function reader(bytes: Uint8Array) {
  const reads: Array<[number, number]> = []
  const read: RangeReader = async (offset, length) => {
    reads.push([offset, length])
    return bytes.slice(offset, offset + length)
  }
  return { read, reads }
}

async function open(name: string) {
  const file = await MkvSubtitleFile.open(reader(fixture(name)).read)
  if (!file) throw new Error('expected subtitles')
  return file
}

async function payloads(file: MkvSubtitleFile, trackIndex: number) {
  const track = file.tracks[trackIndex]
  return Promise.all(track.entries.map((entry) => file.readBlock(track, entry)))
}

describe('MkvSubtitleFile', () => {
  it('lists the text subtitle tracks an ffmpeg mux carries', async () => {
    const file = await open('ffmpeg.mkv')
    expect(
      file.tracks.map(({ format, language, name, isDefault, entries }) => ({
        format,
        language,
        name,
        isDefault,
        count: entries.length,
      })),
    ).toEqual([
      { format: 'srt', language: 'chi', name: '简体', isDefault: false, count: 3 },
      { format: 'srt', language: 'eng', name: null, isDefault: true, count: 2 },
      { format: 'ass', language: 'jpn', name: null, isDefault: false, count: 3 },
    ])
  })

  it('reads block payloads with their timing', async () => {
    const file = await open('ffmpeg.mkv')
    expect(await payloads(file, 0)).toEqual([
      { start: 1, end: 3, payload: '第一句 <i>斜体</i> <font color="#ff0000">红</font>' },
      { start: 4, end: 6.5, payload: '第二句\n两行' },
      { start: 10, end: 12, payload: '第三句 & 符号' },
    ])
    expect((await payloads(file, 2))[0]?.payload).toBe('0,0,Default,,0,0,0,,{\\b1}粗体{\\b0}, 逗号\\N第二行')
  })

  it('reads mkvmerge output, including BCP 47 languages and zlib-compressed tracks', async () => {
    const file = await open('mkvmerge.mkv')
    expect(file.tracks.map((track) => track.language)).toEqual(['zh-Hans', 'en', 'ja'])
    expect(await payloads(file, 1)).toEqual([
      { start: 1, end: 3, payload: 'First' },
      { start: 4, end: 6, payload: 'Second' },
    ])
  })

  it('locates blocks in clusters whose size field length differs from the first cluster', async () => {
    const file = await open('mkvmerge.mkv')
    const track = file.tracks[0]
    // Pretend the first cluster used a 1-byte size so the real length is only found by probing.
    Object.assign(file, { clusterSizeLength: 1 })
    expect(await file.readBlock(track, track.entries[0])).toMatchObject({ start: 1, end: 3 })
  })

  it('returns null for a position that does not hold one of the track’s blocks', async () => {
    const file = await open('ffmpeg.mkv')
    const [chinese, english] = file.tracks
    expect(await file.readBlock(english, chinese.entries[0])).toBeNull()
  })

  it('fetches only the head of the file to open it when the index sits up front', async () => {
    const bytes = fixture('mkvmerge.mkv')
    const { read, reads } = reader(bytes)
    await MkvSubtitleFile.open(read)
    expect(reads[0]).toEqual([0, 64 * 1024])
  })

  it('returns null for files that are not Matroska', async () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
    expect(await MkvSubtitleFile.open(reader(mp4).read)).toBeNull()
  })

  it('returns null when a Matroska file has no text subtitle tracks', async () => {
    const bytes = fixture('ffmpeg.mkv')
    // Rewrite every subtitle CodecID to an image codec the reader does not handle.
    const text = new TextDecoder('latin1').decode(bytes)
    const patched = Uint8Array.from(
      text.replaceAll('S_TEXT/UTF8', 'S_HDMV/PGS!').replaceAll('S_TEXT/ASS', 'S_VOBSUB!!'),
      (c) => c.charCodeAt(0),
    )
    expect(await MkvSubtitleFile.open(reader(patched).read)).toBeNull()
  })
})
