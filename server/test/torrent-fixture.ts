// Builds real v1 torrents for torrent cache tests: file bytes, the bencoded info
// dictionary with SHA-1 piece hashes, its infoHash, and a magnet link.

import { createHash } from 'node:crypto'
import { type BencodeInput, encodeBencode } from '../domain/bencode'

export interface FixtureFile {
  path: string
  bytes: Uint8Array
  padding?: boolean
}

export interface TorrentFixture {
  name: string
  info: Uint8Array
  infoBase64: string
  infoHash: string
  magnet: string
  pieceLength: number
  // Bytes by file index in the info dictionary.
  files: Array<{ fileIdx: number; path: string; bytes: Uint8Array; padding: boolean }>
}

export function fileBytes(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size)
  let state = seed * 2654435761
  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) >>> 0
    out[i] = state >>> 24
  }
  return out
}

export function buildTorrent(name: string, files: FixtureFile[], pieceLength = 16 * 1024): TorrentFixture {
  const concat = new Uint8Array(files.reduce((sum, file) => sum + file.bytes.length, 0))
  let offset = 0
  for (const file of files) {
    concat.set(file.bytes, offset)
    offset += file.bytes.length
  }
  const pieces = new Uint8Array(Math.ceil(concat.length / pieceLength) * 20)
  for (let i = 0; i * pieceLength < concat.length; i++) {
    const digest = createHash('sha1')
      .update(concat.subarray(i * pieceLength, (i + 1) * pieceLength))
      .digest()
    pieces.set(digest, i * 20)
  }
  const single = files.length === 1 && files[0].path === name
  const dict: BencodeInput = single
    ? { name: new TextEncoder().encode(name), 'piece length': pieceLength, pieces, length: concat.length }
    : {
        name: new TextEncoder().encode(name),
        'piece length': pieceLength,
        pieces,
        files: files.map((file) => ({
          length: file.bytes.length,
          path: file.path.split('/').map((segment) => new TextEncoder().encode(segment)),
          ...(file.padding ? { attr: new TextEncoder().encode('p') } : {}),
        })),
      }
  const info = encodeBencode(dict)
  const infoHash = createHash('sha1').update(info).digest('hex')
  return {
    name,
    info,
    infoBase64: Buffer.from(info).toString('base64'),
    infoHash,
    magnet: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`,
    pieceLength,
    files: files.map((file, fileIdx) => ({
      fileIdx,
      path: file.path,
      bytes: file.bytes,
      padding: file.padding ?? false,
    })),
  }
}
