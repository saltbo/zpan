// Tests for src/components/files/file-row-actions.tsx
// Tests pure logic from the component (hasActions, hasWriteActions) without rendering.
import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { computeHasActions, computeHasWriteActions, isZipFile } from './file-row-actions'
import type { FileActionHandlers } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObject(dirtype: DirType = DirType.FILE): StorageObject {
  return {
    id: 'obj-1',
    orgId: 'org-1',
    alias: '',
    name: 'photo.png',
    type: 'image/png',
    size: 1024,
    dirtype,
    parent: '',
    object: '',
    storageId: 'stor-1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// hasActions — determines whether the dropdown should render
// ---------------------------------------------------------------------------

describe('FileRowActions — hasActions logic', () => {
  it('returns false when no handlers are provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onOpen: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(false)
  })

  it('returns true when onCopyUrl handler is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onCopyUrl: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(true)
  })

  it('returns true when onDelete handler is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onDelete: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(true)
  })

  it('returns true when onTrash handler is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onTrash: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(true)
  })

  it('returns true when onDownload is provided and item is a file', () => {
    const item = makeObject(DirType.FILE)
    const handlers: Partial<FileActionHandlers> = { onDownload: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(true)
  })

  it('returns false when onDownload is provided but item is a folder', () => {
    const item = makeObject(DirType.USER_FOLDER)
    const handlers: Partial<FileActionHandlers> = { onDownload: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(false)
  })

  it('returns true when onRename is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onRename: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(true)
  })

  it('returns true when onShare is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onShare: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(true)
  })

  it('returns true when onCopy is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onCopy: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(true)
  })

  it('returns true when onMove is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onMove: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(true)
  })

  it('returns true when onCompress handler is provided', () => {
    const item = makeObject(DirType.USER_FOLDER)
    const handlers: Partial<FileActionHandlers> = { onCompress: vi.fn() }

    expect(computeHasActions(item, handlers)).toBe(true)
  })

  it('returns true for extract only when item is a zip file', () => {
    const zip = { ...makeObject(DirType.FILE), name: 'archive.zip' }
    const text = { ...makeObject(DirType.FILE), name: 'archive.txt' }
    const handlers: Partial<FileActionHandlers> = { onExtract: vi.fn() }

    expect(computeHasActions(zip, handlers)).toBe(true)
    expect(computeHasActions(text, handlers)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hasWriteActions — determines separator visibility
// ---------------------------------------------------------------------------

describe('FileRowActions — hasWriteActions logic', () => {
  it('returns false when only onCopyUrl is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onCopyUrl: vi.fn() }

    expect(computeHasWriteActions(item, handlers)).toBe(false)
  })

  it('returns false when only onDelete is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onDelete: vi.fn() }

    expect(computeHasWriteActions(item, handlers)).toBe(false)
  })

  it('returns false when only onTrash is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onTrash: vi.fn() }

    expect(computeHasWriteActions(item, handlers)).toBe(false)
  })

  it('returns true when onRename is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onRename: vi.fn() }

    expect(computeHasWriteActions(item, handlers)).toBe(true)
  })

  it('returns true when onDownload is provided and item is a file', () => {
    const item = makeObject(DirType.FILE)
    const handlers: Partial<FileActionHandlers> = { onDownload: vi.fn() }

    expect(computeHasWriteActions(item, handlers)).toBe(true)
  })

  it('returns false when onDownload is provided but item is a folder', () => {
    const item = makeObject(DirType.USER_FOLDER)
    const handlers: Partial<FileActionHandlers> = { onDownload: vi.fn() }

    expect(computeHasWriteActions(item, handlers)).toBe(false)
  })

  it('returns true when onCopy is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onCopy: vi.fn() }

    expect(computeHasWriteActions(item, handlers)).toBe(true)
  })

  it('returns true when onMove is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onMove: vi.fn() }

    expect(computeHasWriteActions(item, handlers)).toBe(true)
  })

  it('returns true when onShare is provided', () => {
    const item = makeObject()
    const handlers: Partial<FileActionHandlers> = { onShare: vi.fn() }

    expect(computeHasWriteActions(item, handlers)).toBe(true)
  })
})

describe('FileRowActions — archive visibility logic', () => {
  it('identifies zip files by filename extension', () => {
    expect(isZipFile({ ...makeObject(DirType.FILE), name: 'BACKUP.ZIP' })).toBe(true)
    expect(isZipFile({ ...makeObject(DirType.FILE), name: 'backup.zip.txt' })).toBe(false)
    expect(isZipFile({ ...makeObject(DirType.USER_FOLDER), name: 'folder.zip' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// onCopyUrl — format variant logic
// ---------------------------------------------------------------------------

describe('FileRowActions — onCopyUrl called with correct format', () => {
  it('calls onCopyUrl with "raw" format', () => {
    const onCopyUrl = vi.fn()
    const item = makeObject()

    onCopyUrl(item, 'raw')

    expect(onCopyUrl).toHaveBeenCalledWith(item, 'raw')
  })

  it('calls onCopyUrl with "markdown" format', () => {
    const onCopyUrl = vi.fn()
    const item = makeObject()

    onCopyUrl(item, 'markdown')

    expect(onCopyUrl).toHaveBeenCalledWith(item, 'markdown')
  })

  it('calls onCopyUrl with "html" format', () => {
    const onCopyUrl = vi.fn()
    const item = makeObject()

    onCopyUrl(item, 'html')

    expect(onCopyUrl).toHaveBeenCalledWith(item, 'html')
  })

  it('calls onCopyUrl with "bbcode" format', () => {
    const onCopyUrl = vi.fn()
    const item = makeObject()

    onCopyUrl(item, 'bbcode')

    expect(onCopyUrl).toHaveBeenCalledWith(item, 'bbcode')
  })
})

// ---------------------------------------------------------------------------
// onDelete — called with item
// ---------------------------------------------------------------------------

describe('FileRowActions — onDelete', () => {
  it('calls onDelete with the item when invoked', () => {
    const onDelete = vi.fn()
    const item = makeObject()

    onDelete(item)

    expect(onDelete).toHaveBeenCalledWith(item)
  })
})
