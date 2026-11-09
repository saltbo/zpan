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
  const folder = (name: string) => object(name, '', DirType.USER_FOLDER)
  const linkById = async (id: string) => ({ id, name: id.slice(3), type: '', size: 1, downloadUrl: `https://s3/${id}` })

  function search(siblings: StorageObject[], folders: Record<string, StorageObject[]> = {}, video = 'Movie.mkv') {
    const listFolder = vi.fn(async (path: string) => {
      const entries = folders[path]
      if (!entries) throw new Error(`no folder ${path}`)
      return entries
    })
    return {
      listFolder,
      run: () => resolveSidecarSubtitles({ video: object(video), folderPath: 'films', siblings, listFolder }),
    }
  }

  it('resolves the subtitle files named after a video', async () => {
    getObject.mockImplementation(linkById)
    const { run, listFolder } = search([
      object('Movie.mkv'),
      object('Movie.chs.srt'),
      object('Movie.ass'),
      folder('Movie.srt'),
      object('Other.srt'),
      object('Movie.nfo'),
    ])
    expect(await run()).toEqual([
      { name: 'Movie.chs.srt', url: 'https://s3/id-Movie.chs.srt', format: 'srt', tag: 'chs' },
      { name: 'Movie.ass', url: 'https://s3/id-Movie.ass', format: 'ass', tag: '' },
    ])
    expect(listFolder).not.toHaveBeenCalled()
  })

  it('takes every subtitle in Subs/ when the folder holds a single video', async () => {
    getObject.mockImplementation(linkById)
    const { run, listFolder } = search([object('Movie.mkv'), folder('Subs')], {
      'films/Subs': [object('10_Japanese.srt'), object('2_English.srt'), object('3_Chinese.ass'), object('readme.txt')],
    })
    expect(await run()).toEqual([
      { name: 'Subs/2_English.srt', url: 'https://s3/id-2_English.srt', format: 'srt', tag: '2_English' },
      { name: 'Subs/3_Chinese.ass', url: 'https://s3/id-3_Chinese.ass', format: 'ass', tag: '3_Chinese' },
      { name: 'Subs/10_Japanese.srt', url: 'https://s3/id-10_Japanese.srt', format: 'srt', tag: '10_Japanese' },
    ])
    expect(listFolder).toHaveBeenCalledWith('films/Subs')
  })

  it('uses the per-episode folder in a season and ignores unnamed files beside it', async () => {
    getObject.mockImplementation(linkById)
    const { run } = search(
      [object('Show.S01E01.mkv'), object('Show.S01E02.mkv'), folder('subtitles')],
      {
        'films/subtitles': [
          folder('Show.S01E01'),
          folder('Show.S01E02'),
          object('Show.S01E01.en.srt'),
          object('2_English.srt'),
        ],
        'films/subtitles/Show.S01E01': [object('2_English.srt'), object('3_Chinese (Simplified).srt')],
      },
      'Show.S01E01.mkv',
    )
    expect((await run()).map(({ name, tag }) => [name, tag])).toEqual([
      ['subtitles/Show.S01E01.en.srt', 'en'],
      ['subtitles/Show.S01E01/2_English.srt', '2_English'],
      ['subtitles/Show.S01E01/3_Chinese (Simplified).srt', '3_Chinese (Simplified)'],
    ])
  })

  it('still offers the named subtitles when Subs/ cannot be listed', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    getObject.mockImplementation(linkById)
    const { run } = search([object('Movie.mkv'), object('Movie.srt'), folder('Subs')])
    expect((await run()).map((subtitle) => subtitle.name)).toEqual(['Movie.srt'])
    expect(errors).toHaveBeenCalledWith('Failed to list subtitles in films/Subs', expect.any(Error))
  })

  it('does nothing for files that are not videos', async () => {
    const { run, listFolder } = search([object('Movie.nfo'), object('Movie.srt'), folder('Subs')], {}, 'Movie.nfo')
    expect(await run()).toEqual([])
    expect(getObject).not.toHaveBeenCalled()
    expect(listFolder).not.toHaveBeenCalled()
  })

  it('skips a subtitle whose link cannot be resolved', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    getObject.mockImplementation(async (id: string) => {
      if (id === 'id-Movie.ass') throw new Error('gone')
      return { id, name: id.slice(3), type: '', size: 1 }
    })
    const { run } = search([object('Movie.mkv'), object('Movie.chs.srt'), object('Movie.ass')])
    expect(await run()).toEqual([])
    expect(errors).toHaveBeenCalledWith('Failed to resolve subtitle Movie.ass', expect.any(Error))
  })
})
