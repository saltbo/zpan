import { describe, expect, it } from 'vitest'
import { buildTorrent, fileBytes } from '../test/torrent-fixture'
import { encodeBencode } from './bencode'
import { isR2Storage, samplePieces } from './torrent-cache'
import {
  parseMagnetInfoHash,
  parseTorrentInfo,
  pieceRangeSegments,
  pieceSize,
  TorrentInfoError,
  torrentFileMime,
} from './torrent-info'

describe('parseTorrentInfo', () => {
  it('reads a single-file torrent as one file named after the torrent', () => {
    const torrent = buildTorrent('movie.mkv', [{ path: 'movie.mkv', bytes: fileBytes(40_000, 1) }])
    const info = parseTorrentInfo(torrent.info)
    expect(info).toMatchObject({ name: 'movie.mkv', pieceLength: 16384, pieceCount: 3, totalLength: 40_000 })
    expect(info.files).toEqual([{ fileIdx: 0, path: 'movie.mkv', size: 40_000, padding: false, offset: 0 }])
  })

  it('keeps dictionary positions, offsets, and padding files of a multi-file torrent', () => {
    const torrent = buildTorrent('Show', [
      { path: 'S01/E01.mkv', bytes: fileBytes(10_000, 1) },
      { path: '.pad/6384', bytes: new Uint8Array(6384), padding: true },
      { path: 'S01/E02.mkv', bytes: fileBytes(20_000, 2) },
    ])
    const info = parseTorrentInfo(torrent.info)
    expect(info.files.map((file) => [file.fileIdx, file.path, file.offset, file.padding])).toEqual([
      [0, 'S01/E01.mkv', 0, false],
      [1, '.pad/6384', 10_000, true],
      [2, 'S01/E02.mkv', 16_384, false],
    ])
    expect(pieceRangeSegments(info, 0, 1)).toEqual([
      { fileIdx: 0, padding: false, start: 0, length: 10_000 },
      { fileIdx: 1, padding: true, start: 0, length: 6384 },
    ])
    expect(pieceRangeSegments(info, 1, 3)).toEqual([{ fileIdx: 2, padding: false, start: 0, length: 20_000 }])
    expect(pieceSize(info, 2)).toBe(36_384 - 2 * 16_384)
  })

  it.each([
    ['not bencode', new TextEncoder().encode('nope')],
    ['a v2-only dictionary', encodeBencode({ name: 'x', 'piece length': 16384, 'meta version': 2, length: 1 })],
    [
      'a parent path segment',
      encodeBencode({ name: 'x', 'piece length': 1, pieces: new Uint8Array(20), files: [{ length: 1, path: ['..'] }] }),
    ],
    ['a wrong piece count', encodeBencode({ name: 'x', 'piece length': 1, pieces: new Uint8Array(20), length: 2 })],
    ['an empty torrent', encodeBencode({ name: 'x', 'piece length': 1, pieces: new Uint8Array(0), length: 0 })],
  ])('rejects %s', (_case, bytes) => {
    expect(() => parseTorrentInfo(bytes)).toThrow(TorrentInfoError)
  })
})

describe('parseMagnetInfoHash', () => {
  it('reads hex and base32 infoHashes', () => {
    const hex = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a'
    expect(parseMagnetInfoHash(`magnet:?xt=urn:btih:${hex.toUpperCase()}&dn=x`)).toBe(hex)
    expect(parseMagnetInfoHash('magnet:?dn=x&xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK')).toBe(hex)
    expect(parseMagnetInfoHash('magnet:?xt=urn:btmh:1220abcd')).toBeNull()
  })
})

describe('torrent cache helpers', () => {
  it('detects R2 storages by provider or endpoint', () => {
    expect(isR2Storage({ provider: 'cloudflare-r2', endpoint: 'https://s3.example.com' })).toBe(true)
    expect(isR2Storage({ provider: '', endpoint: 'https://abc.r2.cloudflarestorage.com' })).toBe(true)
    expect(isR2Storage({ provider: 'aws-s3', endpoint: 'https://s3.amazonaws.com' })).toBe(false)
  })

  it('samples distinct pieces, or all of them when there are few', () => {
    expect(samplePieces(5, 32)).toEqual([0, 1, 2, 3, 4])
    const sample = samplePieces(1000, 32)
    expect(new Set(sample).size).toBe(32)
    expect(sample.every((piece) => piece >= 0 && piece < 1000)).toBe(true)
  })

  it('guesses a mime type from the extension', () => {
    expect(torrentFileMime('S01/E01.mkv')).toBe('video/x-matroska')
    expect(torrentFileMime('readme')).toBe('application/octet-stream')
  })
})
