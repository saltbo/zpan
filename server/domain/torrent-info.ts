// Reading a BitTorrent v1 info dictionary (BEP 3) for Torrents: its
// files in dictionary order, padding files (BEP 47), and the piece layout that
// verification walks. Pieces span file boundaries, so a piece is described as the
// file segments it covers, with padding segments read as zeros.

import { type BencodeDict, type BencodeValue, bencodeText, decodeBencode, isBencodeDict } from './bencode'

export const PIECE_HASH_BYTES = 20

export interface TorrentInfoFile {
  // Position in the info dictionary, counting padding files.
  fileIdx: number
  // Path inside the torrent; for a single-file torrent, its name.
  path: string
  size: number
  padding: boolean
  // Offset of the file's first byte in the concatenated torrent data.
  offset: number
}

export interface TorrentInfo {
  name: string
  pieceLength: number
  pieceCount: number
  pieces: Uint8Array
  private: boolean
  totalLength: number
  files: TorrentInfoFile[]
}

export interface PieceSegment {
  fileIdx: number
  padding: boolean
  // Byte range inside the file.
  start: number
  length: number
}

export class TorrentInfoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TorrentInfoError'
  }
}

function text(dict: BencodeDict, key: string): string | null {
  return bencodeText(dict[`${key}.utf-8`]) ?? bencodeText(dict[key])
}

function integer(value: BencodeValue | undefined, what: string, min = 0): number {
  if (typeof value !== 'number' || value < min) throw new TorrentInfoError(`Invalid ${what}`)
  return value
}

function pathSegment(segment: string | null): string {
  if (!segment || segment === '.' || segment === '..' || /[/\\\0]/.test(segment)) {
    throw new TorrentInfoError('Invalid file path')
  }
  return segment
}

function isPadding(entry: BencodeDict, segments: string[]): boolean {
  const attr = bencodeText(entry.attr)
  return (attr?.includes('p') ?? false) || (segments.length > 1 && segments[0] === '.pad')
}

export function parseTorrentInfo(bytes: Uint8Array): TorrentInfo {
  let root: BencodeValue
  try {
    root = decodeBencode(bytes)
  } catch (error) {
    throw new TorrentInfoError(`Info dictionary is not valid bencode: ${(error as Error).message}`)
  }
  if (!isBencodeDict(root)) throw new TorrentInfoError('Info dictionary is not a dictionary')

  const name = pathSegment(text(root, 'name'))
  const pieceLength = integer(root['piece length'], 'piece length', 1)
  const pieces = root.pieces
  if (!(pieces instanceof Uint8Array)) throw new TorrentInfoError('Only v1 and hybrid torrents can be cached')
  if (pieces.length % PIECE_HASH_BYTES !== 0) throw new TorrentInfoError('Invalid piece hashes')

  const files: TorrentInfoFile[] = []
  let offset = 0
  if (root.files === undefined) {
    const size = integer(root.length, 'length')
    files.push({ fileIdx: 0, path: name, size, padding: false, offset })
    offset += size
  } else {
    if (!Array.isArray(root.files) || root.files.length === 0) throw new TorrentInfoError('Invalid file list')
    for (const [fileIdx, entry] of root.files.entries()) {
      if (!isBencodeDict(entry)) throw new TorrentInfoError('Invalid file entry')
      const rawPath = entry['path.utf-8'] ?? entry.path
      if (!Array.isArray(rawPath) || rawPath.length === 0) throw new TorrentInfoError('Invalid file path')
      const segments = rawPath.map((segment) => pathSegment(bencodeText(segment)))
      const size = integer(entry.length, 'file length')
      files.push({ fileIdx, path: segments.join('/'), size, padding: isPadding(entry, segments), offset })
      offset += size
    }
  }

  const totalLength = offset
  if (totalLength <= 0) throw new TorrentInfoError('Torrent is empty')
  const pieceCount = Math.ceil(totalLength / pieceLength)
  if (pieces.length !== pieceCount * PIECE_HASH_BYTES) throw new TorrentInfoError('Piece count does not match length')
  const paths = new Set<string>()
  for (const file of files) {
    if (file.padding) continue
    if (paths.has(file.path)) throw new TorrentInfoError('Duplicate file path')
    paths.add(file.path)
  }

  return {
    name,
    pieceLength,
    pieceCount,
    pieces,
    private: root.private === 1,
    totalLength,
    files,
  }
}

export function pieceHash(info: TorrentInfo, index: number): Uint8Array {
  return info.pieces.subarray(index * PIECE_HASH_BYTES, (index + 1) * PIECE_HASH_BYTES)
}

export function pieceSize(info: TorrentInfo, index: number): number {
  return Math.min(info.pieceLength, info.totalLength - index * info.pieceLength)
}

// The file segments covering pieces [from, to), in order.
export function pieceRangeSegments(info: TorrentInfo, from: number, to: number): PieceSegment[] {
  const start = from * info.pieceLength
  const end = Math.min(to * info.pieceLength, info.totalLength)
  const segments: PieceSegment[] = []
  for (const file of info.files) {
    const fileEnd = file.offset + file.size
    if (fileEnd <= start || file.offset >= end || file.size === 0) continue
    const segmentStart = Math.max(start, file.offset)
    const segmentEnd = Math.min(end, fileEnd)
    segments.push({
      fileIdx: file.fileIdx,
      padding: file.padding,
      start: segmentStart - file.offset,
      length: segmentEnd - segmentStart,
    })
  }
  return segments
}

// Magnet links carry the v1 infoHash as 40 hex or 32 base32 characters.
export function parseMagnetInfoHash(uri: string): string | null {
  const query = uri.replace(/^magnet:\?/i, '')
  for (const part of query.split('&')) {
    const [key, raw] = part.split('=')
    if (key?.toLowerCase() !== 'xt' || !raw) continue
    const value = decodeURIComponent(raw)
    const match = /^urn:btih:([0-9a-z]+)$/i.exec(value)
    if (!match) continue
    const hash = match[1]
    if (/^[0-9a-f]{40}$/i.test(hash)) return hash.toLowerCase()
    if (/^[a-z2-7]{32}$/i.test(hash)) return base32ToHex(hash.toUpperCase())
  }
  return null
}

// The name a magnet link suggests (`dn`), shown until the torrent's metadata
// arrives.
export function parseMagnetDisplayName(uri: string): string | null {
  const query = uri.replace(/^magnet:\?/i, '')
  for (const part of query.split('&')) {
    const eq = part.indexOf('=')
    if (eq < 0 || part.slice(0, eq).toLowerCase() !== 'dn') continue
    try {
      const name = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' ')).trim()
      if (name) return name
    } catch {
      // A malformed escape leaves the name unknown.
    }
  }
  return null
}

function base32ToHex(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of value) bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  let hex = ''
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const MIME_BY_EXTENSION: Record<string, string> = {
  mkv: 'video/x-matroska',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  webm: 'video/webm',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  flv: 'video/x-flv',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  srt: 'application/x-subrip',
  ass: 'text/x-ssa',
  ssa: 'text/x-ssa',
  vtt: 'text/vtt',
  sub: 'text/plain',
  nfo: 'text/plain',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  iso: 'application/x-iso9660-image',
}

export function torrentFileMime(path: string): string {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase()
  return (extension && MIME_BY_EXTENSION[extension]) || 'application/octet-stream'
}
