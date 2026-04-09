import { DirType } from '@zpan/shared/constants'
import type { StorageObject } from '@zpan/shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { connectAdapter, loadFolder, refreshFolder } from './file-manager-adapter'

vi.mock('./api', () => ({
  listObjects: vi.fn(),
  getObject: vi.fn(),
  createObject: vi.fn(),
  updateObject: vi.fn(),
  deleteObject: vi.fn(),
  copyObject: vi.fn(),
}))

function makeStorageObject(overrides: Partial<StorageObject> = {}): StorageObject {
  return {
    id: 'obj1',
    orgId: 'org1',
    alias: 'alias1',
    name: 'my-file.txt',
    type: 'text/plain',
    size: 512,
    dirtype: DirType.FILE,
    parent: '',
    object: 'path/to/obj',
    storageId: 'storage1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    ...overrides,
  }
}

function makeListResponse(items: StorageObject[]) {
  return { items, total: items.length, page: 1, pageSize: 500 }
}

describe('loadFolder', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns entities mapped from listObjects items', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([makeStorageObject()]))

    const result = await loadFolder('', '/')

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('my-file.txt')
    expect(result[0].size).toBe(512)
    expect(result[0].type).toBe('file')
  })

  it('assigns path-based id for items in the root folder', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(
      makeListResponse([makeStorageObject({ id: 'db-id-1', name: 'song.mp3' })]),
    )

    const [entity] = await loadFolder('', '/')

    expect(entity.id).toBe('/song.mp3')
  })

  it('assigns path-based id for items in a nested folder', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(
      makeListResponse([makeStorageObject({ id: 'db-id-2', name: 'track.flac' })]),
    )

    const [entity] = await loadFolder('db-music', '/Music')

    expect(entity.id).toBe('/Music/track.flac')
  })

  it('maps file dirtype to type "file" with lazy false', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([makeStorageObject({ dirtype: DirType.FILE })]))

    const [entity] = await loadFolder('', '/')

    expect(entity.type).toBe('file')
    expect(entity.lazy).toBe(false)
  })

  it('maps user folder dirtype to type "folder" with lazy true', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(
      makeListResponse([makeStorageObject({ dirtype: DirType.USER_FOLDER })]),
    )

    const [entity] = await loadFolder('', '/')

    expect(entity.type).toBe('folder')
    expect(entity.lazy).toBe(true)
  })

  it('converts updatedAt string to a Date instance', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(
      makeListResponse([makeStorageObject({ updatedAt: '2024-06-01T00:00:00Z' })]),
    )

    const [entity] = await loadFolder('', '/')

    expect(entity.date).toBeInstanceOf(Date)
    expect(entity.date!.toISOString()).toBe('2024-06-01T00:00:00.000Z')
  })

  it('returns empty array when folder has no items', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([]))

    const result = await loadFolder('empty-folder', '/Empty')

    expect(result).toEqual([])
  })

  it('passes the dbParentId to listObjects', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([]))

    await loadFolder('db-folder-abc', '/Docs')

    expect(api.listObjects).toHaveBeenCalledWith('db-folder-abc')
  })

  it('handles multiple items, all getting correct path-based ids', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(
      makeListResponse([
        makeStorageObject({ id: 'id-a', name: 'alpha.txt' }),
        makeStorageObject({ id: 'id-b', name: 'beta.pdf' }),
      ]),
    )

    const result = await loadFolder('', '/')

    expect(result[0].id).toBe('/alpha.txt')
    expect(result[1].id).toBe('/beta.pdf')
  })
})

describe('refreshFolder', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls provide-data with the parentPath as the id', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([makeStorageObject()]))
    const execMock = vi.fn()
    const apiMock = { exec: execMock } as never

    await refreshFolder(apiMock, '', '/')

    expect(execMock).toHaveBeenCalledWith('provide-data', {
      id: '/',
      data: expect.any(Array),
      skipProvider: true,
    })
  })

  it('passes the dbParentId to listObjects', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([]))
    const apiMock = { exec: vi.fn() } as never

    await refreshFolder(apiMock, 'db-docs', '/Docs')

    expect(api.listObjects).toHaveBeenCalledWith('db-docs')
  })

  it('passes the loaded entities to provide-data', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(
      makeListResponse([makeStorageObject({ id: 'fid', name: 'report.pdf' })]),
    )
    const execMock = vi.fn()
    const apiMock = { exec: execMock } as never

    await refreshFolder(apiMock, '', '/')

    const [, payload] = execMock.mock.calls[0] as [string, { data: unknown[] }]
    expect(payload.data).toHaveLength(1)
    expect((payload.data[0] as { id: string }).id).toBe('/report.pdf')
  })

  it('uses the nested parentPath as the provide-data id', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([]))
    const execMock = vi.fn()
    const apiMock = { exec: execMock } as never

    await refreshFolder(apiMock, 'db-music', '/Music')

    expect(execMock).toHaveBeenCalledWith('provide-data', expect.objectContaining({ id: '/Music' }))
  })
})

// Helper that builds a fake IApi with intercept capture and trigger
function makeApiMock() {
  const handlers: Record<string, (ev: unknown) => unknown> = {}
  return {
    intercept: vi.fn((event: string, handler: (ev: unknown) => unknown) => {
      handlers[event] = handler
    }),
    exec: vi.fn(),
    trigger: (event: string, ev: unknown) => handlers[event]?.(ev),
  }
}

describe('connectAdapter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('registers intercepts for all required file manager events', () => {
    const apiMock = makeApiMock()
    connectAdapter(apiMock as never)

    const events = apiMock.intercept.mock.calls.map((c) => c[0])
    expect(events).toContain('request-data')
    expect(events).toContain('rename-file')
    expect(events).toContain('create-file')
    expect(events).toContain('delete-files')
    expect(events).toContain('move-files')
    expect(events).toContain('copy-files')
    expect(events).toContain('download-file')
  })

  describe('request-data intercept', () => {
    it('loads folder for the root path and calls provide-data', async () => {
      vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([makeStorageObject()]))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const returnValue = await apiMock.trigger('request-data', { id: '/' })

      // For root path "/" resolveDbId returns '' (empty string)
      expect(api.listObjects).toHaveBeenCalledWith('')
      expect(apiMock.exec).toHaveBeenCalledWith(
        'provide-data',
        expect.objectContaining({ id: '/', skipProvider: true, data: expect.any(Array) }),
      )
      expect(returnValue).toBe(false)
    })

    it('resolves a registered path to its db id before loading folder', async () => {
      // First load root to register mapping for /Music -> db-music
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([makeStorageObject({ id: 'db-music', name: 'Music', dirtype: DirType.USER_FOLDER })]),
      )
      await loadFolder('', '/')

      // Now trigger request-data for /Music — it must resolve to db-music
      vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([]))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await apiMock.trigger('request-data', { id: '/Music' })

      expect(api.listObjects).toHaveBeenCalledWith('db-music')
    })
  })

  describe('rename-file intercept', () => {
    it('resolves path id to db id and calls updateObject with new name', async () => {
      // Register mapping: /song.mp3 -> obj1
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([makeStorageObject({ id: 'obj1', name: 'song.mp3' })]),
      )
      await loadFolder('', '/')

      vi.mocked(api.updateObject).mockResolvedValueOnce(makeStorageObject({ name: 'renamed.mp3' }))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await apiMock.trigger('rename-file', { id: '/song.mp3', name: 'renamed.mp3' })

      expect(api.updateObject).toHaveBeenCalledWith('obj1', { name: 'renamed.mp3' })
    })
  })

  describe('create-file intercept', () => {
    it('creates a folder and returns path-based newId', async () => {
      // Register mapping for parent: /Docs -> db-docs
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([makeStorageObject({ id: 'db-docs', name: 'Docs', dirtype: DirType.USER_FOLDER })]),
      )
      await loadFolder('', '/')

      const created = makeStorageObject({ id: 'new-folder-id', name: 'Projects', dirtype: DirType.USER_FOLDER })
      vi.mocked(api.createObject).mockResolvedValueOnce(created)
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('create-file', {
        file: { name: 'Projects', type: 'folder' },
        parent: '/Docs',
      })

      expect(api.createObject).toHaveBeenCalledWith({
        name: 'Projects',
        type: 'folder',
        parent: 'db-docs',
        dirtype: DirType.USER_FOLDER,
      })
      expect(result).toEqual({ newId: '/Docs/Projects' })
    })

    it('does not create anything for non-folder file type', async () => {
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('create-file', {
        file: { name: 'doc.pdf', type: 'application/pdf' },
        parent: '/',
      })

      expect(api.createObject).not.toHaveBeenCalled()
      expect(result).toBeUndefined()
    })
  })

  describe('delete-files intercept', () => {
    it('resolves path ids to db ids and deletes them all', async () => {
      // Register: /a.txt -> id-a, /b.txt -> id-b
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([
          makeStorageObject({ id: 'id-a', name: 'a.txt' }),
          makeStorageObject({ id: 'id-b', name: 'b.txt' }),
        ]),
      )
      await loadFolder('', '/')

      vi.mocked(api.deleteObject).mockResolvedValue({ id: 'any', deleted: true })
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await apiMock.trigger('delete-files', { ids: ['/a.txt', '/b.txt'] })

      expect(api.deleteObject).toHaveBeenCalledTimes(2)
      expect(api.deleteObject).toHaveBeenCalledWith('id-a')
      expect(api.deleteObject).toHaveBeenCalledWith('id-b')
    })

    it('handles empty ids array without calling deleteObject', async () => {
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await apiMock.trigger('delete-files', { ids: [] })

      expect(api.deleteObject).not.toHaveBeenCalled()
    })

    it('throws with failure count when one delete fails', async () => {
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([
          makeStorageObject({ id: 'id-c', name: 'c.txt' }),
          makeStorageObject({ id: 'id-d', name: 'd.txt' }),
        ]),
      )
      await loadFolder('', '/')

      vi.mocked(api.deleteObject)
        .mockResolvedValueOnce({ id: 'id-c', deleted: true })
        .mockRejectedValueOnce(new Error('not found'))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await expect(apiMock.trigger('delete-files', { ids: ['/c.txt', '/d.txt'] })).rejects.toThrow(
        '1 operation(s) failed',
      )
    })

    it('throws with total failure count when all deletes fail', async () => {
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([
          makeStorageObject({ id: 'id-e', name: 'e.txt' }),
          makeStorageObject({ id: 'id-f', name: 'f.txt' }),
          makeStorageObject({ id: 'id-g', name: 'g.txt' }),
        ]),
      )
      await loadFolder('', '/')

      vi.mocked(api.deleteObject)
        .mockRejectedValueOnce(new Error('err1'))
        .mockRejectedValueOnce(new Error('err2'))
        .mockRejectedValueOnce(new Error('err3'))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await expect(apiMock.trigger('delete-files', { ids: ['/e.txt', '/f.txt', '/g.txt'] })).rejects.toThrow(
        '3 operation(s) failed',
      )
    })
  })

  describe('move-files intercept', () => {
    it('resolves path ids to db ids and moves them to the target', async () => {
      // Register: /file1.txt -> db-id-1, /file2.txt -> db-id-2, /Dest -> db-dest
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([
          makeStorageObject({ id: 'db-id-1', name: 'file1.txt' }),
          makeStorageObject({ id: 'db-id-2', name: 'file2.txt' }),
          makeStorageObject({ id: 'db-dest', name: 'Dest', dirtype: DirType.USER_FOLDER }),
        ]),
      )
      await loadFolder('', '/')

      vi.mocked(api.updateObject)
        .mockResolvedValueOnce(makeStorageObject({ id: 'db-id-1', name: 'file1.txt', parent: 'db-dest' }))
        .mockResolvedValueOnce(makeStorageObject({ id: 'db-id-2', name: 'file2.txt', parent: 'db-dest' }))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('move-files', { ids: ['/file1.txt', '/file2.txt'], target: '/Dest' })

      expect(api.updateObject).toHaveBeenCalledWith('db-id-1', { parent: 'db-dest' })
      expect(api.updateObject).toHaveBeenCalledWith('db-id-2', { parent: 'db-dest' })
      expect(result).toEqual({ newIds: ['/Dest/file1.txt', '/Dest/file2.txt'] })
    })

    it('returns empty newIds for empty ids array', async () => {
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('move-files', { ids: [], target: '/' })

      expect(result).toEqual({ newIds: [] })
    })

    it('throws with failure count when one move fails', async () => {
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([
          makeStorageObject({ id: 'mv-a', name: 'mv-a.txt' }),
          makeStorageObject({ id: 'mv-b', name: 'mv-b.txt' }),
        ]),
      )
      await loadFolder('', '/')

      vi.mocked(api.updateObject)
        .mockResolvedValueOnce(makeStorageObject({ id: 'mv-a', name: 'mv-a.txt' }))
        .mockRejectedValueOnce(new Error('forbidden'))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await expect(apiMock.trigger('move-files', { ids: ['/mv-a.txt', '/mv-b.txt'], target: '/' })).rejects.toThrow(
        '1 operation(s) failed',
      )
    })
  })

  describe('copy-files intercept', () => {
    it('resolves path ids to db ids and copies them to the target', async () => {
      // Register: /orig1.txt -> db-orig1, /orig2.txt -> db-orig2, /CopyDest -> db-copy-dest
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([
          makeStorageObject({ id: 'db-orig1', name: 'orig1.txt' }),
          makeStorageObject({ id: 'db-orig2', name: 'orig2.txt' }),
          makeStorageObject({ id: 'db-copy-dest', name: 'CopyDest', dirtype: DirType.USER_FOLDER }),
        ]),
      )
      await loadFolder('', '/')

      vi.mocked(api.copyObject)
        .mockResolvedValueOnce(makeStorageObject({ id: 'cp1', name: 'orig1.txt' }))
        .mockResolvedValueOnce(makeStorageObject({ id: 'cp2', name: 'orig2.txt' }))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('copy-files', { ids: ['/orig1.txt', '/orig2.txt'], target: '/CopyDest' })

      expect(api.copyObject).toHaveBeenCalledWith('db-orig1', 'db-copy-dest')
      expect(api.copyObject).toHaveBeenCalledWith('db-orig2', 'db-copy-dest')
      expect(result).toEqual({ newIds: ['/CopyDest/orig1.txt', '/CopyDest/orig2.txt'] })
    })

    it('returns empty newIds for empty ids array', async () => {
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('copy-files', { ids: [], target: '/' })

      expect(result).toEqual({ newIds: [] })
    })

    it('throws with failure count when one copy fails', async () => {
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([
          makeStorageObject({ id: 'cp-src-a', name: 'cp-src-a.txt' }),
          makeStorageObject({ id: 'cp-src-b', name: 'cp-src-b.txt' }),
        ]),
      )
      await loadFolder('', '/')

      vi.mocked(api.copyObject)
        .mockResolvedValueOnce(makeStorageObject({ id: 'cp-dst-a', name: 'cp-src-a.txt' }))
        .mockRejectedValueOnce(new Error('conflict'))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await expect(
        apiMock.trigger('copy-files', { ids: ['/cp-src-a.txt', '/cp-src-b.txt'], target: '/' }),
      ).rejects.toThrow('1 operation(s) failed')
    })
  })

  describe('download-file intercept', () => {
    it('resolves path id to db id and opens downloadUrl in a new tab', async () => {
      // Register: /report.pdf -> db-report
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([makeStorageObject({ id: 'db-report', name: 'report.pdf' })]),
      )
      await loadFolder('', '/')

      vi.mocked(api.getObject).mockResolvedValueOnce({
        ...makeStorageObject({ id: 'db-report' }),
        downloadUrl: 'https://s3/report.pdf',
      })
      const openMock = vi.fn()
      vi.stubGlobal('window', { open: openMock })

      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('download-file', { id: '/report.pdf' })

      expect(api.getObject).toHaveBeenCalledWith('db-report')
      expect(openMock).toHaveBeenCalledWith('https://s3/report.pdf', '_blank', 'noopener,noreferrer')
      expect(result).toBe(false)

      vi.unstubAllGlobals()
    })

    it('does not open window when downloadUrl is absent', async () => {
      vi.mocked(api.listObjects).mockResolvedValueOnce(
        makeListResponse([makeStorageObject({ id: 'db-nodl', name: 'nodl.bin' })]),
      )
      await loadFolder('', '/')

      vi.mocked(api.getObject).mockResolvedValueOnce(makeStorageObject({ id: 'db-nodl' }))
      const openMock = vi.fn()
      vi.stubGlobal('window', { open: openMock })

      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await apiMock.trigger('download-file', { id: '/nodl.bin' })

      expect(openMock).not.toHaveBeenCalled()

      vi.unstubAllGlobals()
    })
  })
})

describe('buildPath (via loadFolder)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('builds root-level path as /name when parent is /', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([makeStorageObject({ name: 'hello.txt' })]))

    const [entity] = await loadFolder('', '/')

    expect(entity.id).toBe('/hello.txt')
  })

  it('builds nested path as parentPath/name when parent is not /', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([makeStorageObject({ name: 'nested.txt' })]))

    const [entity] = await loadFolder('db-photos', '/Photos/Vacation')

    expect(entity.id).toBe('/Photos/Vacation/nested.txt')
  })
})

describe('resolveDbId (via connectAdapter request-data)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty string for the root path "/"', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce(makeListResponse([]))
    const apiMock = makeApiMock()
    connectAdapter(apiMock as never)

    await apiMock.trigger('request-data', { id: '/' })

    expect(api.listObjects).toHaveBeenCalledWith('')
  })

  it('throws when no mapping is registered for the path', async () => {
    const apiMock = makeApiMock()
    connectAdapter(apiMock as never)

    await expect(apiMock.trigger('request-data', { id: '/UnknownPath' })).rejects.toThrow(
      'No DB mapping for path: /UnknownPath',
    )
  })
})
