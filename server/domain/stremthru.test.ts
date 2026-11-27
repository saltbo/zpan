import { describe, expect, it } from 'vitest'
import {
  decodeFileLink,
  encodeFileLink,
  magnetFor,
  parseCheckHash,
  StremThruError,
  storeToken,
  torzFile,
  torzSource,
  torzStatus,
} from './stremthru'
import { parseMagnetInfoHash } from './torrent-info'

const HASH = 'ab'.repeat(20)

describe('StremThru protocol shapes', () => {
  it('maps download task statuses onto torz statuses', () => {
    expect(
      ['queued', 'assigned', 'paused', 'downloading', 'uploading', 'completed', 'failed', 'canceled', 'canceling'].map(
        torzStatus,
      ),
    ).toEqual(['queued', 'queued', 'queued', 'downloading', 'uploading', 'downloaded', 'failed', 'failed', 'failed'])
  })

  it('lists a file by its index with the path inside the root folder', () => {
    expect(torzFile({ fileIdx: 3, path: 'Season 1/E01.mkv', size: 9 }, 'zpan:st:m1')).toEqual({
      index: 3,
      link: 'zpan:st:m1',
      path: '/Season 1/E01.mkv',
      name: 'E01.mkv',
      size: 9,
    })
    expect(torzFile({ fileIdx: 0, path: 'Movie.mkv', size: 1 })).toEqual({
      index: 0,
      path: '/Movie.mkv',
      name: 'Movie.mkv',
      size: 1,
    })
  })

  it('round-trips opaque file links and rejects anything else', () => {
    expect(decodeFileLink(encodeFileLink('abc_123'))).toBe('abc_123')
    expect(decodeFileLink('https://example.com/file')).toBeNull()
    expect(decodeFileLink('zpan:st:../../etc')).toBeNull()
    expect(decodeFileLink('zpan:st:')).toBeNull()
  })

  it('parses hex, base32, and magnet hashes for check', () => {
    expect(parseCheckHash(HASH.toUpperCase())).toBe(HASH)
    expect(parseCheckHash('VOVOVOVOVOVOVOVOVOVOVOVOVOVOVOVO')).toBe(
      parseMagnetInfoHash('magnet:?xt=urn:btih:VOVOVOVOVOVOVOVOVOVOVOVOVOVOVOVO'),
    )
    expect(parseCheckHash('VOVOVOVOVOVOVOVOVOVOVOVOVOVOVOVO')).toMatch(/^[0-9a-f]{40}$/)
    expect(parseCheckHash(`magnet:?xt=urn:btih:${HASH}&dn=x`)).toBe(HASH)
    expect(parseCheckHash('not-a-hash')).toBeNull()
  })

  it('turns an added link into a download source', () => {
    expect(torzSource(`magnet:?xt=urn:btih:${HASH}`)).toEqual({ type: 'magnet', uri: `magnet:?xt=urn:btih:${HASH}` })
    expect(torzSource('magnet:?dn=no-hash')).toBeNull()
    expect(torzSource(HASH)).toEqual({ type: 'magnet', uri: magnetFor(HASH) })
    expect(torzSource('https://tracker.example/file.torrent')).toEqual({
      type: 'torrent_url',
      uri: 'https://tracker.example/file.torrent',
    })
    expect(torzSource('ftp://example.com/x')).toBeNull()
  })

  it('reads the store key from either header, with or without Bearer', () => {
    expect(storeToken({ storeAuthorization: 'Bearer k1', authorization: 'Bearer k2' })).toBe('k1')
    expect(storeToken({ storeAuthorization: null, authorization: 'bearer k2' })).toBe('k2')
    expect(storeToken({ storeAuthorization: 'k3' })).toBe('k3')
    expect(storeToken({ storeAuthorization: '  ', authorization: 'Basic a b' })).toBeNull()
    expect(storeToken({})).toBeNull()
  })

  it('carries the HTTP status of each error code', () => {
    expect(new StremThruError('PAYMENT_REQUIRED', 'x').status).toBe(402)
    expect(new StremThruError('TOO_MANY_REQUESTS', 'x').status).toBe(429)
  })
})
