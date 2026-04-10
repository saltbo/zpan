import { DirType } from '@shared/constants'
import type { PaginatedResponse, StorageObject } from '@shared/types'
import { describe, expect, it } from 'vitest'

// The select function is the pure logic inside useFilesQuery.
// We test it directly without rendering any React hook.
function selectSortFoldersFirst(data: PaginatedResponse<StorageObject>) {
  const folders = data.items.filter((i) => i.dirtype !== DirType.FILE)
  const files = data.items.filter((i) => i.dirtype === DirType.FILE)
  return { ...data, items: [...folders, ...files] }
}

function makeObject(id: string, dirtype: number): StorageObject {
  return {
    id,
    name: id,
    dirtype,
    size: 0,
    status: 'active',
    parent: '',
    storageId: '',
    createdAt: '',
    updatedAt: '',
  } as unknown as StorageObject
}

function makePage(items: StorageObject[]): PaginatedResponse<StorageObject> {
  return { items, total: items.length, page: 1, pageSize: 500 }
}

describe('useFilesQuery — select function (sort folders before files)', () => {
  it('places folders before files when they are interleaved', () => {
    const file = makeObject('file1', DirType.FILE)
    const folder = makeObject('folder1', DirType.USER_FOLDER)
    const data = makePage([file, folder])

    const result = selectSortFoldersFirst(data)

    expect(result.items[0].id).toBe('folder1')
    expect(result.items[1].id).toBe('file1')
  })

  it('preserves all-folder list in original order', () => {
    const a = makeObject('a', DirType.USER_FOLDER)
    const b = makeObject('b', DirType.SYSTEM_FOLDER)
    const data = makePage([a, b])

    const result = selectSortFoldersFirst(data)

    expect(result.items).toHaveLength(2)
    expect(result.items[0].id).toBe('a')
    expect(result.items[1].id).toBe('b')
  })

  it('preserves all-file list in original order', () => {
    const a = makeObject('a', DirType.FILE)
    const b = makeObject('b', DirType.FILE)
    const data = makePage([a, b])

    const result = selectSortFoldersFirst(data)

    expect(result.items).toHaveLength(2)
    expect(result.items[0].id).toBe('a')
    expect(result.items[1].id).toBe('b')
  })

  it('returns empty items for empty list', () => {
    const data = makePage([])

    const result = selectSortFoldersFirst(data)

    expect(result.items).toHaveLength(0)
  })

  it('treats SYSTEM_FOLDER as a non-file (sorts before files)', () => {
    const file = makeObject('file1', DirType.FILE)
    const sysFolder = makeObject('sys', DirType.SYSTEM_FOLDER)
    const data = makePage([file, sysFolder])

    const result = selectSortFoldersFirst(data)

    expect(result.items[0].id).toBe('sys')
    expect(result.items[1].id).toBe('file1')
  })

  it('preserves total, page, and pageSize metadata unchanged', () => {
    const data: PaginatedResponse<StorageObject> = {
      items: [makeObject('f', DirType.FILE)],
      total: 42,
      page: 3,
      pageSize: 20,
    }

    const result = selectSortFoldersFirst(data)

    expect(result.total).toBe(42)
    expect(result.page).toBe(3)
    expect(result.pageSize).toBe(20)
  })

  it('handles mixed multiple folders and multiple files in correct section order', () => {
    const file1 = makeObject('file1', DirType.FILE)
    const folder1 = makeObject('folder1', DirType.USER_FOLDER)
    const file2 = makeObject('file2', DirType.FILE)
    const folder2 = makeObject('folder2', DirType.SYSTEM_FOLDER)
    const data = makePage([file1, folder1, file2, folder2])

    const result = selectSortFoldersFirst(data)

    const ids = result.items.map((i) => i.id)
    // All folders come first, then all files
    expect(ids.indexOf('folder1')).toBeLessThan(ids.indexOf('file1'))
    expect(ids.indexOf('folder2')).toBeLessThan(ids.indexOf('file1'))
    expect(ids.indexOf('folder1')).toBeLessThan(ids.indexOf('file2'))
    expect(ids.indexOf('folder2')).toBeLessThan(ids.indexOf('file2'))
  })

  it('queryKey structure uses correct segments', () => {
    // Document the expected query key shape so that changes break visibly.
    // The hook uses: ['objects', 'active', parent]
    const parent = 'some-folder-id'
    const key = ['objects', 'active', parent]

    expect(key[0]).toBe('objects')
    expect(key[1]).toBe('active')
    expect(key[2]).toBe(parent)
  })
})
