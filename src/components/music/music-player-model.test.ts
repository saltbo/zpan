import { DirType, ObjectStatus } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { isMusicPreviewFile, toPreviewFile } from './music-player-model'

function makeObject(overrides: Partial<StorageObject & { downloadUrl?: string }> = {}): StorageObject & {
  downloadUrl?: string
} {
  return {
    id: 'track-1',
    orgId: 'org-1',
    alias: 'track-1',
    name: 'song.mp3',
    type: 'audio/mpeg',
    size: 4096,
    dirtype: DirType.FILE,
    parent: '',
    object: 'object-key',
    storageId: 'storage-1',
    status: ObjectStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    downloadUrl: 'https://example.com/song.mp3',
    ...overrides,
  }
}

describe('music player model', () => {
  it('detects audio preview files by extension or MIME type', () => {
    expect(isMusicPreviewFile({ id: '1', name: 'song.mp3', type: '', size: 1, downloadUrl: 'u' })).toBe(true)
    expect(isMusicPreviewFile({ id: '2', name: 'song.bin', type: 'audio/flac', size: 1, downloadUrl: 'u' })).toBe(true)
    expect(isMusicPreviewFile({ id: '3', name: 'movie.mp4', type: 'video/mp4', size: 1, downloadUrl: 'u' })).toBe(false)
  })

  it('converts storage objects with a download URL into preview files', () => {
    expect(toPreviewFile(makeObject())).toEqual({
      id: 'track-1',
      name: 'song.mp3',
      type: 'audio/mpeg',
      size: 4096,
      downloadUrl: 'https://example.com/song.mp3',
    })
  })

  it('fails when an object cannot be played because its download URL is missing', () => {
    expect(() => toPreviewFile(makeObject({ downloadUrl: undefined }))).toThrow('Audio download URL is missing')
  })
})
