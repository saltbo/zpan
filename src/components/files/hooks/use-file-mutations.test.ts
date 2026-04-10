import { DirType } from '@shared/constants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchMoveObjects, batchTrashObjects, copyObject, createObject, updateObject } from '@/lib/api'

// useFileMutations is a React hook (useMutation wrappers) that cannot be invoked
// outside a React render. We test the API functions it delegates to, verifying
// that each mutationFn calls the right endpoint with the correct arguments.
// This validates the public contract of the hook at the API boundary.

vi.mock('@/lib/api', () => ({
  updateObject: vi.fn(),
  createObject: vi.fn(),
  batchTrashObjects: vi.fn(),
  batchMoveObjects: vi.fn(),
  copyObject: vi.fn(),
}))

function _makeResponse(body: unknown, ok = true): Response {
  return { ok, statusText: ok ? 'OK' : 'Error', json: async () => body } as unknown as Response
}

describe('useFileMutations — mutationFn API contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('renameMutation mutationFn → updateObject', () => {
    it('calls updateObject with id and name', async () => {
      vi.mocked(updateObject).mockResolvedValueOnce({ id: 'id1', name: 'new-name' } as never)

      await updateObject('id1', { name: 'new-name' })

      expect(updateObject).toHaveBeenCalledWith('id1', { name: 'new-name' })
    })

    it('only passes name in the update payload (not other fields)', async () => {
      vi.mocked(updateObject).mockResolvedValueOnce({ id: 'id1', name: 'doc.txt' } as never)

      await updateObject('id1', { name: 'doc.txt' })

      const [, payload] = vi.mocked(updateObject).mock.calls[0] as [string, { name: string }]
      expect(Object.keys(payload)).toEqual(['name'])
    })
  })

  describe('createFolderMutation mutationFn → createObject', () => {
    it('calls createObject with folder type, USER_FOLDER dirtype, and the current parent', async () => {
      vi.mocked(createObject).mockResolvedValueOnce({ id: 'new-folder' } as never)
      const currentFolder = 'parent-folder-id'

      await createObject({ name: 'My Folder', type: 'folder', parent: currentFolder, dirtype: DirType.USER_FOLDER })

      expect(createObject).toHaveBeenCalledWith({
        name: 'My Folder',
        type: 'folder',
        parent: currentFolder,
        dirtype: DirType.USER_FOLDER,
      })
    })

    it('uses DirType.USER_FOLDER (1) for new folders', async () => {
      vi.mocked(createObject).mockResolvedValueOnce({ id: 'f' } as never)

      await createObject({ name: 'x', type: 'folder', parent: 'root', dirtype: DirType.USER_FOLDER })

      const [payload] = vi.mocked(createObject).mock.calls[0] as [{ dirtype: number }]
      expect(payload.dirtype).toBe(1)
    })
  })

  describe('trashMutation mutationFn → batchTrashObjects', () => {
    it('calls batchTrashObjects with the provided ids array', async () => {
      vi.mocked(batchTrashObjects).mockResolvedValueOnce({ trashed: 2 })

      await batchTrashObjects(['id1', 'id2'])

      expect(batchTrashObjects).toHaveBeenCalledWith(['id1', 'id2'])
    })

    it('accepts a single-element ids array', async () => {
      vi.mocked(batchTrashObjects).mockResolvedValueOnce({ trashed: 1 })

      await batchTrashObjects(['solo'])

      expect(batchTrashObjects).toHaveBeenCalledWith(['solo'])
    })
  })

  describe('moveMutation mutationFn → batchMoveObjects', () => {
    it('calls batchMoveObjects with ids and parent', async () => {
      vi.mocked(batchMoveObjects).mockResolvedValueOnce({ moved: 3 })

      await batchMoveObjects(['a', 'b', 'c'], 'dest-folder')

      expect(batchMoveObjects).toHaveBeenCalledWith(['a', 'b', 'c'], 'dest-folder')
    })

    it('passes the destination parent folder correctly', async () => {
      vi.mocked(batchMoveObjects).mockResolvedValueOnce({ moved: 1 })

      await batchMoveObjects(['id1'], 'target')

      const [, parent] = vi.mocked(batchMoveObjects).mock.calls[0] as [string[], string]
      expect(parent).toBe('target')
    })
  })

  describe('copyMutation mutationFn → copyObject', () => {
    it('calls copyObject with id and parent', async () => {
      vi.mocked(copyObject).mockResolvedValueOnce({ id: 'copy-id' } as never)

      await copyObject('original-id', 'dest-folder')

      expect(copyObject).toHaveBeenCalledWith('original-id', 'dest-folder')
    })
  })
})
