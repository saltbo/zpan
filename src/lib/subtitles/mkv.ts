import { children, type EbmlElement, readElementHeader, readString, readUint, readVint } from './ebml'

/** Reads `length` bytes at `offset`; may return fewer at the end of the file. */
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>

export type TextSubtitleFormat = 'srt' | 'ass' | 'vtt'

export interface MkvSubtitleEntry {
  /** Seconds. */
  start: number
  /** Seconds, from the Cues index; the block's own duration wins when present. */
  duration: number | null
  clusterOffset: number
  relativePosition: number
}

export interface MkvSubtitleTrack {
  number: number
  format: TextSubtitleFormat
  /** BCP 47 or ISO 639-2 code as written by the muxer; null when undetermined. */
  language: string | null
  name: string | null
  isDefault: boolean
  isForced: boolean
  entries: MkvSubtitleEntry[]
}

export interface MkvSubtitleBlock {
  start: number
  end: number
  /** The block payload as written by the muxer (SRT text, ASS event line or WebVTT cue text). */
  payload: string
}

type Compression = { algorithm: 'zlib' } | { algorithm: 'header-stripping'; prefix: Uint8Array }

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  Language: 0x22b59c,
  LanguageBCP47: 0x22b59d,
  Name: 0x536e,
  FlagDefault: 0x88,
  FlagForced: 0x55aa,
  ContentEncodings: 0x6d80,
  ContentEncoding: 0x6240,
  ContentCompression: 0x5034,
  ContentCompAlgo: 0x4254,
  ContentCompSettings: 0x4255,
  ContentEncryption: 0x5035,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  CueRelativePosition: 0xf0,
  CueDuration: 0xb2,
  Cluster: 0x1f43b675,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
  SimpleBlock: 0xa3,
} as const

const SUBTITLE_TRACK_TYPE = 0x11
const CODEC_FORMATS: Record<string, TextSubtitleFormat> = {
  'S_TEXT/UTF8': 'srt',
  'S_TEXT/ASCII': 'srt',
  'S_TEXT/ASS': 'ass',
  'S_TEXT/SSA': 'ass',
  S_ASS: 'ass',
  S_SSA: 'ass',
  'S_TEXT/WEBVTT': 'vtt',
  'D_WEBVTT/SUBTITLES': 'vtt',
}

const HEAD_BYTES = 64 * 1024
const HEADER_BYTES = 12
const MAX_TOP_LEVEL_ELEMENTS = 64
// Text subtitle blocks are a few hundred bytes; larger ones get a second read.
const BLOCK_READ_BYTES = 4 * 1024
const MAX_CLUSTER_SIZE_LENGTH = 8

/**
 * Text subtitles from a Matroska file, read through the Cues index so only the header,
 * the index and the subtitle blocks themselves are fetched, not the whole file.
 */
export class MkvSubtitleFile {
  private constructor(
    private readonly read: RangeReader,
    readonly tracks: MkvSubtitleTrack[],
    private readonly segmentStart: number,
    private readonly timestampScale: number,
    private readonly clusterSizeLength: number,
    private readonly compression: Map<number, Compression>,
  ) {}

  /** Null when the file isn't Matroska or carries no readable text subtitles. */
  static async open(read: RangeReader): Promise<MkvSubtitleFile | null> {
    const head = await read(0, HEAD_BYTES)
    const bytes = (offset: number, length: number) =>
      offset + length <= head.length ? Promise.resolve(head.subarray(offset, offset + length)) : read(offset, length)
    const headerAt = async (offset: number) => readElementHeader(await bytes(offset, HEADER_BYTES), 0, offset)
    const body = (element: EbmlElement) => bytes(element.offset + element.headerSize, element.size ?? 0)

    const ebml = readElementHeader(head, 0)
    if (ebml?.id !== ID.EBML || ebml.size === null) return null
    const segment = await headerAt(ebml.headerSize + ebml.size)
    if (segment?.id !== ID.Segment) return null
    const segmentStart = segment.offset + segment.headerSize

    const positions = new Map<number, number>()
    let firstCluster: EbmlElement | null = null
    let pos = segmentStart
    for (let i = 0; i < MAX_TOP_LEVEL_ELEMENTS; i++) {
      const element = await headerAt(pos)
      if (!element) break
      if (element.id === ID.Cluster) {
        firstCluster = element
        break
      }
      if (!positions.has(element.id)) positions.set(element.id, element.offset)
      if (element.size === null) break
      pos = element.offset + element.headerSize + element.size
    }

    // Cues usually sit after the clusters; the SeekHead (possibly a second one) points at them.
    const visitedSeekHeads = new Set<number>()
    let seekHeadOffset = positions.get(ID.SeekHead)
    while (seekHeadOffset !== undefined && !visitedSeekHeads.has(seekHeadOffset)) {
      visitedSeekHeads.add(seekHeadOffset)
      const seekHead = await headerAt(seekHeadOffset)
      if (seekHead?.id !== ID.SeekHead || seekHead.size === null) break
      let nextSeekHead: number | undefined
      for (const [id, offset] of parseSeekHead(await body(seekHead))) {
        const absolute = segmentStart + offset
        if (id === ID.SeekHead && !visitedSeekHeads.has(absolute)) nextSeekHead = absolute
        else if (!positions.has(id)) positions.set(id, absolute)
      }
      seekHeadOffset = nextSeekHead
    }

    const loadElement = async (id: number) => {
      const offset = positions.get(id)
      if (offset === undefined) return null
      const element = await headerAt(offset)
      if (element?.id !== id || element.size === null) return null
      return body(element)
    }

    const tracksBody = await loadElement(ID.Tracks)
    if (!tracksBody) return null
    const { tracks, compression } = parseSubtitleTracks(tracksBody)
    if (tracks.length === 0) return null

    const infoBody = await loadElement(ID.Info)
    const timestampScale = (infoBody && parseTimestampScale(infoBody)) ?? 1_000_000
    const cuesBody = await loadElement(ID.Cues)
    if (cuesBody) addCueEntries(cuesBody, tracks, timestampScale / 1e9)

    const clusterSizeLength = firstCluster ? firstCluster.headerSize - 4 : MAX_CLUSTER_SIZE_LENGTH
    return new MkvSubtitleFile(read, tracks, segmentStart, timestampScale, clusterSizeLength, compression)
  }

  async readBlock(track: MkvSubtitleTrack, entry: MkvSubtitleEntry): Promise<MkvSubtitleBlock | null> {
    const clusterStart = this.segmentStart + entry.clusterOffset
    // The relative position counts from the cluster's data, so it depends on how many bytes the muxer
    // used for this cluster's size. Read a window that covers every possible length and check each.
    const windowStart = clusterStart + 4 + 1 + entry.relativePosition
    const window = await this.read(windowStart, MAX_CLUSTER_SIZE_LENGTH - 1 + BLOCK_READ_BYTES)
    const lengths = [this.clusterSizeLength, 1, 2, 3, 4, 5, 6, 7, 8].filter(
      (length, index, all) => all.indexOf(length) === index,
    )
    for (const length of lengths) {
      const offset = length - 1
      const element = readElementHeader(window, offset, windowStart)
      if (!element || element.size === null) continue
      if (element.id !== ID.BlockGroup && element.id !== ID.SimpleBlock) continue
      const end = offset + element.headerSize + element.size
      const elementBytes =
        end <= window.length
          ? window.subarray(offset, end)
          : await this.read(element.offset, element.headerSize + element.size)
      const block = parseBlockElement(elementBytes, element)
      if (block?.trackNumber !== track.number) continue
      const durationTicks = block.duration
      const duration = durationTicks === null ? entry.duration : (durationTicks * this.timestampScale) / 1e9
      if (duration === null) return null
      return {
        start: entry.start,
        end: entry.start + duration,
        payload: await this.decodePayload(track, block.data),
      }
    }
    return null
  }

  private async decodePayload(track: MkvSubtitleTrack, data: Uint8Array): Promise<string> {
    const compression = this.compression.get(track.number)
    let bytes = data
    if (compression?.algorithm === 'header-stripping') {
      bytes = new Uint8Array(compression.prefix.length + data.length)
      bytes.set(compression.prefix)
      bytes.set(data, compression.prefix.length)
    } else if (compression?.algorithm === 'zlib') {
      const inflate = new DecompressionStream('deflate')
      const writer = inflate.writable.getWriter()
      const [inflated] = await Promise.all([
        new Response(inflate.readable).arrayBuffer(),
        writer.write(data as Uint8Array<ArrayBuffer>),
        writer.close(),
      ])
      bytes = new Uint8Array(inflated)
    }
    return readString(bytes, 0, bytes.length)
  }
}

function parseSeekHead(bytes: Uint8Array): Array<[number, number]> {
  const seeks: Array<[number, number]> = []
  for (const seek of children(bytes)) {
    if (seek.id !== ID.Seek) continue
    let id: number | null = null
    let position: number | null = null
    for (const field of children(bytes, seek.dataStart, seek.dataStart + (seek.size ?? 0))) {
      if (field.id === ID.SeekID) id = readUint(bytes, field.dataStart, field.size ?? 0)
      if (field.id === ID.SeekPosition) position = readUint(bytes, field.dataStart, field.size ?? 0)
    }
    if (id !== null && position !== null) seeks.push([id, position])
  }
  return seeks
}

function parseTimestampScale(bytes: Uint8Array): number | null {
  for (const field of children(bytes)) {
    if (field.id === ID.TimestampScale) return readUint(bytes, field.dataStart, field.size ?? 0)
  }
  return null
}

function parseSubtitleTracks(bytes: Uint8Array) {
  const tracks: MkvSubtitleTrack[] = []
  const compression = new Map<number, Compression>()
  for (const entry of children(bytes)) {
    if (entry.id !== ID.TrackEntry) continue
    const end = entry.dataStart + (entry.size ?? 0)
    let number = 0
    let type = 0
    let codec = ''
    let language: string | null = 'eng'
    let languageBcp47: string | null = null
    let name: string | null = null
    let isDefault = true
    let isForced = false
    let encoding: Compression | 'unsupported' | null = null
    for (const field of children(bytes, entry.dataStart, end)) {
      const size = field.size ?? 0
      switch (field.id) {
        case ID.TrackNumber:
          number = readUint(bytes, field.dataStart, size)
          break
        case ID.TrackType:
          type = readUint(bytes, field.dataStart, size)
          break
        case ID.CodecID:
          codec = readString(bytes, field.dataStart, size)
          break
        case ID.Language:
          language = readString(bytes, field.dataStart, size)
          break
        case ID.LanguageBCP47:
          languageBcp47 = readString(bytes, field.dataStart, size)
          break
        case ID.Name:
          name = readString(bytes, field.dataStart, size) || null
          break
        case ID.FlagDefault:
          isDefault = readUint(bytes, field.dataStart, size) === 1
          break
        case ID.FlagForced:
          isForced = readUint(bytes, field.dataStart, size) === 1
          break
        case ID.ContentEncodings:
          encoding = parseContentEncodings(bytes, field.dataStart, field.dataStart + size)
          break
      }
    }
    const format = CODEC_FORMATS[codec]
    if (type !== SUBTITLE_TRACK_TYPE || !format || number === 0 || encoding === 'unsupported') continue
    if (encoding) compression.set(number, encoding)
    const code = languageBcp47 ?? language
    tracks.push({
      number,
      format,
      language: code && code !== 'und' ? code : null,
      name,
      isDefault,
      isForced,
      entries: [],
    })
  }
  return { tracks, compression }
}

function parseContentEncodings(bytes: Uint8Array, start: number, end: number): Compression | 'unsupported' | null {
  let result: Compression | null = null
  for (const encoding of children(bytes, start, end)) {
    if (encoding.id !== ID.ContentEncoding) continue
    for (const field of children(bytes, encoding.dataStart, encoding.dataStart + (encoding.size ?? 0))) {
      if (field.id === ID.ContentEncryption) return 'unsupported'
      if (field.id !== ID.ContentCompression) continue
      let algorithm = 0
      let settings = new Uint8Array()
      for (const option of children(bytes, field.dataStart, field.dataStart + (field.size ?? 0))) {
        if (option.id === ID.ContentCompAlgo) algorithm = readUint(bytes, option.dataStart, option.size ?? 0)
        if (option.id === ID.ContentCompSettings) {
          settings = bytes.slice(option.dataStart, option.dataStart + (option.size ?? 0))
        }
      }
      if (algorithm === 0) result = { algorithm: 'zlib' }
      else if (algorithm === 3) result = { algorithm: 'header-stripping', prefix: settings }
      else return 'unsupported'
    }
  }
  return result
}

function addCueEntries(bytes: Uint8Array, tracks: MkvSubtitleTrack[], secondsPerTick: number) {
  const byNumber = new Map(tracks.map((track) => [track.number, track]))
  for (const point of children(bytes)) {
    if (point.id !== ID.CuePoint) continue
    const end = point.dataStart + (point.size ?? 0)
    let time: number | null = null
    for (const field of children(bytes, point.dataStart, end)) {
      if (field.id === ID.CueTime) time = readUint(bytes, field.dataStart, field.size ?? 0)
      if (field.id !== ID.CueTrackPositions || time === null) continue
      let trackNumber = 0
      let clusterOffset: number | null = null
      let relativePosition: number | null = null
      let duration: number | null = null
      for (const position of children(bytes, field.dataStart, field.dataStart + (field.size ?? 0))) {
        const value = readUint(bytes, position.dataStart, position.size ?? 0)
        if (position.id === ID.CueTrack) trackNumber = value
        if (position.id === ID.CueClusterPosition) clusterOffset = value
        if (position.id === ID.CueRelativePosition) relativePosition = value
        if (position.id === ID.CueDuration) duration = value
      }
      const track = byNumber.get(trackNumber)
      // Without a relative position the block could be anywhere in a multi-megabyte cluster.
      if (!track || clusterOffset === null || relativePosition === null) continue
      track.entries.push({
        start: time * secondsPerTick,
        duration: duration === null ? null : duration * secondsPerTick,
        clusterOffset,
        relativePosition,
      })
    }
  }
}

function parseBlockElement(bytes: Uint8Array, element: EbmlElement) {
  let blockStart = element.headerSize
  let blockEnd = bytes.length
  let duration: number | null = null
  if (element.id === ID.BlockGroup) {
    let found = false
    for (const child of children(bytes, element.headerSize)) {
      if (child.id === ID.Block) {
        blockStart = child.dataStart
        blockEnd = child.dataStart + (child.size ?? 0)
        found = true
      }
      if (child.id === ID.BlockDuration) duration = readUint(bytes, child.dataStart, child.size ?? 0)
    }
    if (!found) return null
  }
  const trackNumber = readVint(bytes, blockStart)
  if (!trackNumber?.value) return null
  const flagsAt = blockStart + trackNumber.length + 2
  // Laced blocks pack several frames; text subtitle muxers never write them.
  if (flagsAt >= blockEnd || (bytes[flagsAt] & 0x06) !== 0) return null
  return { trackNumber: trackNumber.value, duration, data: bytes.subarray(flagsAt + 1, blockEnd) }
}
