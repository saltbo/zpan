import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import type { ColumnDef, Row } from '@tanstack/react-table'
import { describe, expect, it, vi } from 'vitest'
import { getColumns } from './columns'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObject(id: string, dirtype: number, extra: Partial<StorageObject> = {}): StorageObject {
  return {
    id,
    name: id,
    dirtype,
    size: 0,
    status: 'active',
    parent: '',
    storageId: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    orgId: '',
    alias: '',
    type: '',
    object: '',
    ...extra,
  } as StorageObject
}

function makeRow(obj: StorageObject): Row<StorageObject> {
  return {
    original: obj,
    getIsSelected: vi.fn(() => false),
    toggleSelected: vi.fn(),
    getValue: vi.fn((key: string) => obj[key as keyof StorageObject]),
  } as unknown as Row<StorageObject>
}

const noopHandlers = {
  onOpen: vi.fn(),
  onRename: vi.fn(),
  onMove: vi.fn(),
  onTrash: vi.fn(),
  onCopy: vi.fn(),
  onDownload: vi.fn(),
}

const t = (key: string) => key

// ---------------------------------------------------------------------------
// Column shape
// ---------------------------------------------------------------------------

describe('getColumns — column definitions', () => {
  it('returns five columns', () => {
    const cols = getColumns(noopHandlers, t)

    expect(cols).toHaveLength(5)
  })

  it('first column id is select', () => {
    const cols = getColumns(noopHandlers, t)

    expect(cols[0].id).toBe('select')
  })

  it('second column accessorKey is name', () => {
    const cols = getColumns(noopHandlers, t)
    const col = cols[1] as ColumnDef<StorageObject> & { accessorKey?: string }

    expect(col.accessorKey).toBe('name')
  })

  it('third column accessorKey is size', () => {
    const cols = getColumns(noopHandlers, t)
    const col = cols[2] as ColumnDef<StorageObject> & { accessorKey?: string }

    expect(col.accessorKey).toBe('size')
  })

  it('fourth column accessorKey is updatedAt', () => {
    const cols = getColumns(noopHandlers, t)
    const col = cols[3] as ColumnDef<StorageObject> & { accessorKey?: string }

    expect(col.accessorKey).toBe('updatedAt')
  })

  it('last column id is actions', () => {
    const cols = getColumns(noopHandlers, t)

    expect(cols[4].id).toBe('actions')
  })
})

// ---------------------------------------------------------------------------
// Responsive meta.className
// ---------------------------------------------------------------------------

describe('getColumns — size column meta.className', () => {
  it('size column has meta.className set to "hidden sm:table-cell"', () => {
    const cols = getColumns(noopHandlers, t)
    const sizeCol = cols[2]

    expect(sizeCol.meta).toBeDefined()
    expect((sizeCol.meta as { className: string }).className).toBe('hidden sm:table-cell')
  })
})

describe('getColumns — modified column meta.className', () => {
  it('updatedAt column has meta.className set to "hidden md:table-cell"', () => {
    const cols = getColumns(noopHandlers, t)
    const modifiedCol = cols[3]

    expect(modifiedCol.meta).toBeDefined()
    expect((modifiedCol.meta as { className: string }).className).toBe('hidden md:table-cell')
  })
})

describe('getColumns — select column meta.className', () => {
  it('select column meta.className is "w-8 px-2" (always visible)', () => {
    const cols = getColumns(noopHandlers, t)
    const selectCol = cols[0]

    expect((selectCol.meta as { className: string }).className).toBe('w-8 px-2')
  })
})

// ---------------------------------------------------------------------------
// Sorting: folders-first logic
// ---------------------------------------------------------------------------

describe('getColumns — name column sortingFn (folders first)', () => {
  it('sorts folder before file regardless of alphabetical order', () => {
    const cols = getColumns(noopHandlers, t)
    const nameCol = cols[1] as ColumnDef<StorageObject> & {
      sortingFn: (a: Row<StorageObject>, b: Row<StorageObject>, id: string) => number
    }

    const folderRow = makeRow(makeObject('z-folder', DirType.USER_FOLDER))
    const fileRow = makeRow(makeObject('a-file', DirType.FILE))

    const result = nameCol.sortingFn(fileRow, folderRow, 'name')

    // file vs folder: folder should come first, so file > folder → positive
    expect(result).toBeGreaterThan(0)
  })

  it('returns 0 for two folders of the same name when folder order is same', () => {
    const cols = getColumns(noopHandlers, t)
    const nameCol = cols[1] as ColumnDef<StorageObject> & {
      sortingFn: (a: Row<StorageObject>, b: Row<StorageObject>, id: string) => number
    }

    const folderA = makeRow(makeObject('same', DirType.USER_FOLDER))
    const folderB = makeRow(makeObject('same', DirType.USER_FOLDER))

    const result = nameCol.sortingFn(folderA, folderB, 'name')

    expect(result).toBe(0)
  })

  it('sorts two files by name alphabetically', () => {
    const cols = getColumns(noopHandlers, t)
    const nameCol = cols[1] as ColumnDef<StorageObject> & {
      sortingFn: (a: Row<StorageObject>, b: Row<StorageObject>, id: string) => number
    }

    const fileA = makeRow(makeObject('apple', DirType.FILE))
    const fileB = makeRow(makeObject('banana', DirType.FILE))

    const result = nameCol.sortingFn(fileA, fileB, 'name')

    expect(result).toBeLessThan(0)
  })
})

describe('getColumns — size column sortingFn (folders first)', () => {
  it('sorts folder before file', () => {
    const cols = getColumns(noopHandlers, t)
    const sizeCol = cols[2] as ColumnDef<StorageObject> & {
      sortingFn: (a: Row<StorageObject>, b: Row<StorageObject>, id: string) => number
    }

    const folderRow = makeRow(makeObject('folder', DirType.USER_FOLDER, { size: 0 }))
    const fileRow = makeRow(makeObject('file', DirType.FILE, { size: 9999 }))

    const result = sizeCol.sortingFn(fileRow, folderRow, 'size')

    expect(result).toBeGreaterThan(0)
  })

  it('sorts two files by size ascending', () => {
    const cols = getColumns(noopHandlers, t)
    const sizeCol = cols[2] as ColumnDef<StorageObject> & {
      sortingFn: (a: Row<StorageObject>, b: Row<StorageObject>, id: string) => number
    }

    const smallFile = makeRow(makeObject('small', DirType.FILE, { size: 100 }))
    const bigFile = makeRow(makeObject('big', DirType.FILE, { size: 5000 }))

    // small < big → negative
    const result = sizeCol.sortingFn(smallFile, bigFile, 'size')

    expect(result).toBeLessThan(0)
  })
})

describe('getColumns — updatedAt column sortingFn (folders first)', () => {
  it('sorts folder before file', () => {
    const cols = getColumns(noopHandlers, t)
    const dateCol = cols[3] as ColumnDef<StorageObject> & {
      sortingFn: (a: Row<StorageObject>, b: Row<StorageObject>, id: string) => number
    }

    const folderRow = makeRow(makeObject('folder', DirType.USER_FOLDER, { updatedAt: '2024-01-01T00:00:00.000Z' }))
    const fileRow = makeRow(makeObject('file', DirType.FILE, { updatedAt: '2020-01-01T00:00:00.000Z' }))

    const result = dateCol.sortingFn(fileRow, folderRow, 'updatedAt')

    expect(result).toBeGreaterThan(0)
  })

  it('sorts two files by updatedAt chronologically', () => {
    const cols = getColumns(noopHandlers, t)
    const dateCol = cols[3] as ColumnDef<StorageObject> & {
      sortingFn: (a: Row<StorageObject>, b: Row<StorageObject>, id: string) => number
    }

    const olderFile = makeRow(makeObject('old', DirType.FILE, { updatedAt: '2020-01-01T00:00:00.000Z' }))
    const newerFile = makeRow(makeObject('new', DirType.FILE, { updatedAt: '2024-01-01T00:00:00.000Z' }))

    const result = dateCol.sortingFn(olderFile, newerFile, 'updatedAt')

    expect(result).toBeLessThan(0)
  })
})

// ---------------------------------------------------------------------------
// size column cell renderer
// ---------------------------------------------------------------------------

describe('getColumns — size column cell renderer', () => {
  it('returns em-dash for a folder row', () => {
    const cols = getColumns(noopHandlers, t)
    const sizeCol = cols[2] as ColumnDef<StorageObject> & {
      cell: (ctx: { row: Row<StorageObject> }) => string
    }

    const folderRow = makeRow(makeObject('folder', DirType.USER_FOLDER))
    const result = sizeCol.cell({ row: folderRow })

    expect(result).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// size column cell renderer — file branch
// ---------------------------------------------------------------------------

describe('getColumns — size column cell renderer (file)', () => {
  it('returns formatted size string for a file row', () => {
    const cols = getColumns(noopHandlers, t)
    const sizeCol = cols[2] as ColumnDef<StorageObject> & {
      cell: (ctx: { row: Row<StorageObject> }) => string
    }

    const fileRow = makeRow(makeObject('file', DirType.FILE, { size: 1024 }))
    const result = sizeCol.cell({ row: fileRow })

    expect(result).toBe('1.0 KB')
  })

  it('returns "0 B" for a file with zero size', () => {
    const cols = getColumns(noopHandlers, t)
    const sizeCol = cols[2] as ColumnDef<StorageObject> & {
      cell: (ctx: { row: Row<StorageObject> }) => string
    }

    const fileRow = makeRow(makeObject('file', DirType.FILE, { size: 0 }))
    const result = sizeCol.cell({ row: fileRow })

    expect(result).toBe('0 B')
  })
})

// ---------------------------------------------------------------------------
// updatedAt column cell renderer
// ---------------------------------------------------------------------------

describe('getColumns — updatedAt column cell renderer', () => {
  it('returns a formatted date string for a valid ISO date', () => {
    const cols = getColumns(noopHandlers, t)
    const dateCol = cols[3] as ColumnDef<StorageObject> & {
      cell: (ctx: { getValue: () => string }) => string
    }

    const result = dateCol.cell({ getValue: () => '2024-06-01T00:00:00.000Z' })

    expect(result).toBeTruthy()
    expect(result).not.toBe('—')
  })

  it('returns "—" for an empty updatedAt value', () => {
    const cols = getColumns(noopHandlers, t)
    const dateCol = cols[3] as ColumnDef<StorageObject> & {
      cell: (ctx: { getValue: () => string }) => string
    }

    const result = dateCol.cell({ getValue: () => '' })

    expect(result).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// updatedAt sortingFn — two same-type items (both files)
// ---------------------------------------------------------------------------

describe('getColumns — updatedAt column sortingFn (same dates)', () => {
  it('returns 0 for two files with identical updatedAt timestamps', () => {
    const cols = getColumns(noopHandlers, t)
    const dateCol = cols[3] as ColumnDef<StorageObject> & {
      sortingFn: (a: Row<StorageObject>, b: Row<StorageObject>, id: string) => number
    }

    const fileA = makeRow(makeObject('a', DirType.FILE, { updatedAt: '2024-01-01T00:00:00.000Z' }))
    const fileB = makeRow(makeObject('b', DirType.FILE, { updatedAt: '2024-01-01T00:00:00.000Z' }))

    const result = dateCol.sortingFn(fileA, fileB, 'updatedAt')

    expect(result).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// size sortingFn — equal sizes
// ---------------------------------------------------------------------------

describe('getColumns — size column sortingFn (equal sizes)', () => {
  it('returns 0 for two files with identical size', () => {
    const cols = getColumns(noopHandlers, t)
    const sizeCol = cols[2] as ColumnDef<StorageObject> & {
      sortingFn: (a: Row<StorageObject>, b: Row<StorageObject>, id: string) => number
    }

    const fileA = makeRow(makeObject('a', DirType.FILE, { size: 500 }))
    const fileB = makeRow(makeObject('b', DirType.FILE, { size: 500 }))

    const result = sizeCol.sortingFn(fileA, fileB, 'size')

    expect(result).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Sorting flags
// ---------------------------------------------------------------------------

describe('getColumns — sorting flags', () => {
  it('select column has enableSorting false', () => {
    const cols = getColumns(noopHandlers, t)

    expect(cols[0].enableSorting).toBe(false)
  })

  it('actions column has enableSorting false', () => {
    const cols = getColumns(noopHandlers, t)

    expect(cols[4].enableSorting).toBe(false)
  })
})
