import { describe, expect, it } from 'vitest'
import {
  isTorrentKey,
  normalizeTorrentFolder,
  selectTorrentsToEvict,
  torrentEntryObjectKey,
  torrentInfoHashOfKey,
  torrentKeyRange,
  torrentTreeRoot,
} from './torrents'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-06-01T00:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY)

describe('torrent keys', () => {
  it('recognizes only keys under bt/', () => {
    expect(isTorrentKey(torrentEntryObjectKey('ab', 'e1'))).toBe(true)
    expect(isTorrentKey('org/user/20260101/token.mkv')).toBe(false)
    expect(isTorrentKey('ih/org/img.png')).toBe(false)
  })

  it('reads the infoHash out of a bt/ key', () => {
    expect(torrentInfoHashOfKey(torrentEntryObjectKey('ab', 'e1'))).toBe('ab')
    expect(torrentInfoHashOfKey('org/user/20260101/token.mkv')).toBeNull()
    expect(torrentInfoHashOfKey('bt/')).toBeNull()
  })

  it('bounds a torrent key range to that torrent', () => {
    const { from, to } = torrentKeyRange('ab')
    const inRange = (key: string) => key >= from && key < to
    expect(inRange('bt/ab/0')).toBe(true)
    expect(inRange('bt/ab/info')).toBe(true)
    expect(inRange('bt/abc/0')).toBe(false)
    expect(inRange('bt/aa/0')).toBe(false)
  })
})

describe('torrentTreeRoot', () => {
  it('wraps a multi-file torrent in a folder named after it and leaves a single file bare', () => {
    expect(torrentTreeRoot({ name: 'Show' }, [{ path: 'a.mkv' }, { path: 'b.mkv' }])).toBe('Show')
    expect(torrentTreeRoot({ name: 'Show' }, [{ path: 'Season 1/a.mkv' }])).toBe('Show')
    expect(torrentTreeRoot({ name: 'movie.mkv' }, [{ path: 'movie.mkv' }])).toBeNull()
  })
})

describe('normalizeTorrentFolder', () => {
  it('trims segments and drops empty ones', () => {
    expect(normalizeTorrentFolder(' /Media//Movies / ')).toBe('Media/Movies')
    expect(normalizeTorrentFolder('')).toBe('')
  })
})

describe('selectTorrentsToEvict', () => {
  const candidates = [
    { id: 'recent', size: 100, lastAccessedAt: daysAgo(1) },
    { id: 'old', size: 100, lastAccessedAt: daysAgo(40) },
    { id: 'middle', size: 100, lastAccessedAt: daysAgo(10) },
  ]

  it('selects torrents past the retention period when no capacity is set', () => {
    const selected = selectTorrentsToEvict(candidates, { now, retentionDays: 30, capacityBytes: null, totalBytes: 300 })
    expect(selected.map((c) => c.id)).toEqual(['old'])
  })

  it('keeps evicting oldest first while the instance exceeds its capacity', () => {
    const selected = selectTorrentsToEvict(candidates, { now, retentionDays: 30, capacityBytes: 150, totalBytes: 300 })
    expect(selected.map((c) => c.id)).toEqual(['old', 'middle'])
  })

  it('selects nothing while every torrent is recent and the torrents fit', () => {
    expect(selectTorrentsToEvict(candidates, { now, retentionDays: 60, capacityBytes: 1000, totalBytes: 300 })).toEqual(
      [],
    )
  })
})
