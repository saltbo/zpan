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
    parent: 'root',
    object: 'path/to/obj',
    storageId: 'storage1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    ...overrides,
  }
}

describe('loadFolder', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns entities mapped from listObjects items', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce({
      items: [makeStorageObject()],
      total: 1,
      page: 1,
      pageSize: 500,
    })

    const result = await loadFolder('root')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'obj1',
      name: 'my-file.txt',
      size: 512,
      type: 'file',
    })
  })

  it('maps file dirtype to type "file"', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce({
      items: [makeStorageObject({ dirtype: DirType.FILE })],
      total: 1,
      page: 1,
      pageSize: 500,
    })

    const [entity] = await loadFolder('root')

    expect(entity.type).toBe('file')
    expect(entity.lazy).toBe(false)
  })

  it('maps folder dirtype to type "folder" with lazy true', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce({
      items: [makeStorageObject({ dirtype: DirType.USER_FOLDER })],
      total: 1,
      page: 1,
      pageSize: 500,
    })

    const [entity] = await loadFolder('root')

    expect(entity.type).toBe('folder')
    expect(entity.lazy).toBe(true)
  })

  it('converts updatedAt string to Date object', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce({
      items: [makeStorageObject({ updatedAt: '2024-06-01T00:00:00Z' })],
      total: 1,
      page: 1,
      pageSize: 500,
    })

    const [entity] = await loadFolder('root')

    expect(entity.date).toBeInstanceOf(Date)
    expect(entity.date!.toISOString()).toBe('2024-06-01T00:00:00.000Z')
  })

  it('preserves alias, status, and parent as custom fields', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce({
      items: [makeStorageObject({ alias: 'my-alias', status: 'active', parent: 'folder1' })],
      total: 1,
      page: 1,
      pageSize: 500,
    })

    const [entity] = await loadFolder('root')

    expect((entity as Record<string, unknown>)._alias).toBe('my-alias')
    expect((entity as Record<string, unknown>)._status).toBe('active')
    expect((entity as Record<string, unknown>)._parent).toBe('folder1')
  })

  it('returns empty array when folder has no items', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 500 })

    const result = await loadFolder('empty-folder')

    expect(result).toEqual([])
  })

  it('passes parent argument to listObjects', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 500 })

    await loadFolder('folder-abc')

    expect(api.listObjects).toHaveBeenCalledWith('folder-abc')
  })
})

describe('refreshFolder', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls loadFolder and execs provide-data with the loaded entities', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce({
      items: [makeStorageObject()],
      total: 1,
      page: 1,
      pageSize: 500,
    })
    const execMock = vi.fn()
    const apiMock = { exec: execMock } as never

    await refreshFolder(apiMock, 'root')

    expect(api.listObjects).toHaveBeenCalledWith('root')
    expect(execMock).toHaveBeenCalledWith('provide-data', {
      id: 'root',
      data: expect.any(Array),
      skipProvider: true,
    })
  })

  it('passes the correct entities to provide-data', async () => {
    vi.mocked(api.listObjects).mockResolvedValueOnce({
      items: [makeStorageObject({ id: 'f1', name: 'report.pdf' })],
      total: 1,
      page: 1,
      pageSize: 500,
    })
    const execMock = vi.fn()
    const apiMock = { exec: execMock } as never

    await refreshFolder(apiMock, 'docs')

    const [, payload] = execMock.mock.calls[0] as [string, { data: unknown[] }]
    expect(payload.data).toHaveLength(1)
    expect((payload.data[0] as { id: string }).id).toBe('f1')
  })
})

// Helper to create an IApi mock with intercept recording
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

  it('registers intercepts for all file manager events', () => {
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
    it('loads folder and calls provide-data with loaded entities', async () => {
      vi.mocked(api.listObjects).mockResolvedValueOnce({
        items: [makeStorageObject()],
        total: 1,
        page: 1,
        pageSize: 500,
      })
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const returnValue = await apiMock.trigger('request-data', { id: 'root' })

      expect(api.listObjects).toHaveBeenCalledWith('root')
      expect(apiMock.exec).toHaveBeenCalledWith(
        'provide-data',
        expect.objectContaining({
          id: 'root',
          skipProvider: true,
          data: expect.any(Array),
        }),
      )
      expect(returnValue).toBe(false)
    })
  })

  describe('rename-file intercept', () => {
    it('calls updateObject with new name', async () => {
      vi.mocked(api.updateObject).mockResolvedValueOnce(makeStorageObject({ name: 'new-name.txt' }))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await apiMock.trigger('rename-file', { id: 'id1', name: 'new-name.txt' })

      expect(api.updateObject).toHaveBeenCalledWith('id1', { name: 'new-name.txt' })
    })
  })

  describe('create-file intercept', () => {
    it('creates a folder object and returns newId', async () => {
      const created = makeStorageObject({ id: 'new-folder', dirtype: DirType.USER_FOLDER })
      vi.mocked(api.createObject).mockResolvedValueOnce(created)
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('create-file', {
        file: { name: 'My Folder', type: 'folder' },
        parent: 'root',
      })

      expect(api.createObject).toHaveBeenCalledWith({
        name: 'My Folder',
        type: 'folder',
        parent: 'root',
        dirtype: DirType.USER_FOLDER,
      })
      expect(result).toEqual({ newId: 'new-folder' })
    })

    it('does nothing and returns undefined for non-folder file type', async () => {
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('create-file', {
        file: { name: 'doc.pdf', type: 'application/pdf' },
        parent: 'root',
      })

      expect(api.createObject).not.toHaveBeenCalled()
      expect(result).toBeUndefined()
    })
  })

  describe('delete-files intercept', () => {
    it('deletes all provided ids', async () => {
      vi.mocked(api.deleteObject).mockResolvedValue({ id: 'any', deleted: true })
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await apiMock.trigger('delete-files', { ids: ['id1', 'id2', 'id3'] })

      expect(api.deleteObject).toHaveBeenCalledTimes(3)
      expect(api.deleteObject).toHaveBeenCalledWith('id1')
      expect(api.deleteObject).toHaveBeenCalledWith('id2')
      expect(api.deleteObject).toHaveBeenCalledWith('id3')
    })

    it('handles empty ids array without calling deleteObject', async () => {
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await apiMock.trigger('delete-files', { ids: [] })

      expect(api.deleteObject).not.toHaveBeenCalled()
    })

    it('throws with failure count when one delete fails', async () => {
      vi.mocked(api.deleteObject)
        .mockResolvedValueOnce({ id: 'id1', deleted: true })
        .mockRejectedValueOnce(new Error('not found'))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await expect(apiMock.trigger('delete-files', { ids: ['id1', 'id2'] })).rejects.toThrow('1 operation(s) failed')
    })

    it('throws with total failure count when all deletes fail', async () => {
      vi.mocked(api.deleteObject)
        .mockRejectedValueOnce(new Error('err1'))
        .mockRejectedValueOnce(new Error('err2'))
        .mockRejectedValueOnce(new Error('err3'))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await expect(apiMock.trigger('delete-files', { ids: ['a', 'b', 'c'] })).rejects.toThrow('3 operation(s) failed')
    })
  })

  describe('move-files intercept', () => {
    it('updates parent for all ids and returns newIds', async () => {
      vi.mocked(api.updateObject)
        .mockResolvedValueOnce(makeStorageObject({ id: 'id1', parent: 'folder2' }))
        .mockResolvedValueOnce(makeStorageObject({ id: 'id2', parent: 'folder2' }))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('move-files', { ids: ['id1', 'id2'], target: 'folder2' })

      expect(api.updateObject).toHaveBeenCalledWith('id1', { parent: 'folder2' })
      expect(api.updateObject).toHaveBeenCalledWith('id2', { parent: 'folder2' })
      expect(result).toEqual({ newIds: ['id1', 'id2'] })
    })

    it('returns empty newIds for empty ids array', async () => {
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('move-files', { ids: [], target: 'folder2' })

      expect(result).toEqual({ newIds: [] })
    })

    it('throws with failure count when one move fails', async () => {
      vi.mocked(api.updateObject)
        .mockResolvedValueOnce(makeStorageObject({ id: 'id1', parent: 'folder2' }))
        .mockRejectedValueOnce(new Error('forbidden'))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await expect(apiMock.trigger('move-files', { ids: ['id1', 'id2'], target: 'folder2' })).rejects.toThrow(
        '1 operation(s) failed',
      )
    })
  })

  describe('copy-files intercept', () => {
    it('copies all ids to target and returns newIds', async () => {
      vi.mocked(api.copyObject)
        .mockResolvedValueOnce(makeStorageObject({ id: 'copy1' }))
        .mockResolvedValueOnce(makeStorageObject({ id: 'copy2' }))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('copy-files', { ids: ['orig1', 'orig2'], target: 'dest' })

      expect(api.copyObject).toHaveBeenCalledWith('orig1', 'dest')
      expect(api.copyObject).toHaveBeenCalledWith('orig2', 'dest')
      expect(result).toEqual({ newIds: ['copy1', 'copy2'] })
    })

    it('returns empty newIds for empty ids array', async () => {
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('copy-files', { ids: [], target: 'dest' })

      expect(result).toEqual({ newIds: [] })
    })

    it('throws with failure count when one copy fails', async () => {
      vi.mocked(api.copyObject)
        .mockResolvedValueOnce(makeStorageObject({ id: 'copy1' }))
        .mockRejectedValueOnce(new Error('conflict'))
      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await expect(apiMock.trigger('copy-files', { ids: ['orig1', 'orig2'], target: 'dest' })).rejects.toThrow(
        '1 operation(s) failed',
      )
    })
  })

  describe('download-file intercept', () => {
    it('opens download URL in new tab when downloadUrl is present', async () => {
      vi.mocked(api.getObject).mockResolvedValueOnce({
        ...makeStorageObject(),
        downloadUrl: 'https://s3/file.txt',
      })
      const openMock = vi.fn()
      vi.stubGlobal('window', { open: openMock })

      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      const result = await apiMock.trigger('download-file', { id: 'id1' })

      expect(api.getObject).toHaveBeenCalledWith('id1')
      expect(openMock).toHaveBeenCalledWith('https://s3/file.txt', '_blank', 'noopener,noreferrer')
      expect(result).toBe(false)

      vi.unstubAllGlobals()
    })

    it('does not open window when downloadUrl is absent', async () => {
      vi.mocked(api.getObject).mockResolvedValueOnce(makeStorageObject())
      const openMock = vi.fn()
      vi.stubGlobal('window', { open: openMock })

      const apiMock = makeApiMock()
      connectAdapter(apiMock as never)

      await apiMock.trigger('download-file', { id: 'id1' })

      expect(openMock).not.toHaveBeenCalled()

      vi.unstubAllGlobals()
    })
  })
})
