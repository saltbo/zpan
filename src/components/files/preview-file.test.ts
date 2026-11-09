import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePreviewFile, resolveSidecarSubtitles } from './preview-file'

const getObject = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ getObject }))

const object = (name: string, type = '', dirtype: number = DirType.FILE) =>
  ({ id: `id-${name}`, name, type, size: 10, dirtype }) as StorageObject

afterEach(() => vi.clearAllMocks())

describe('resolvePreviewFile', () => {
  it('uses the data source when it provides the file', async () => {
    const provided = { id: '1', name: 'a.mkv', type: '', size: 1, downloadUrl: 'https://share/a.mkv' }
    expect(await resolvePreviewFile(object('a.mkv'), async () => provided)).toBe(provided)
    expect(getObject).not.toHaveBeenCalled()
  })

  it('falls back to the object API and requires a download link', async () => {
    getObject.mockResolvedValueOnce({
      id: '1',
      name: 'a.mkv',
      type: 'video/x-matroska',
      size: 5,
      downloadUrl: 'https://s3/a',
    })
    expect(await resolvePreviewFile(object('a.mkv'), async () => null)).toEqual({
      id: '1',
      name: 'a.mkv',
      type: 'video/x-matroska',
      size: 5,
      downloadUrl: 'https://s3/a',
    })
    getObject.mockResolvedValueOnce({ id: '1', name: 'a.mkv', type: '', size: 5 })
    expect(await resolvePreviewFile(object('a.mkv'))).toBeNull()
  })
})

describe('resolveSidecarSubtitles', () => {
  const siblings = [
    object('Movie.mkv'),
    object('Movie.chs.srt'),
    object('Movie.ass'),
    object('Movie.srt', '', DirType.USER_FOLDER),
    object('Other.srt'),
    object('Movie.nfo'),
  ]

  it('resolves the subtitle files named after a video', async () => {
    getObject.mockImplementation(async (id: string) => ({
      id,
      name: id.slice(3),
      type: '',
      size: 1,
      downloadUrl: `https://s3/${id}`,
    }))
    expect(await resolveSidecarSubtitles(object('Movie.mkv'), siblings)).toEqual([
      { name: 'Movie.chs.srt', url: 'https://s3/id-Movie.chs.srt' },
      { name: 'Movie.ass', url: 'https://s3/id-Movie.ass' },
    ])
  })

  it('does nothing for files that are not videos', async () => {
    expect(await resolveSidecarSubtitles(object('Movie.nfo'), siblings)).toEqual([])
    expect(getObject).not.toHaveBeenCalled()
  })

  it('skips a subtitle whose link cannot be resolved', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    getObject.mockImplementation(async (id: string) => {
      if (id === 'id-Movie.ass') throw new Error('gone')
      return { id, name: id.slice(3), type: '', size: 1 }
    })
    expect(await resolveSidecarSubtitles(object('Movie.mkv'), siblings)).toEqual([])
    expect(errors).toHaveBeenCalledWith('Failed to resolve subtitle Movie.ass', expect.any(Error))
  })
})
