// Rendering tests for src/components/files/file-row-actions.tsx
// Covers the JSX branches: dropdown render, CopyUrl sub-menu, onDelete.
import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileActionsContextContent } from './file-actions-menu'
import { FileRowActions } from './file-row-actions'
import type { FileActionHandlers, MediaLibraryActions } from './types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('lucide-react', () => ({
  Archive: () => null,
  Clapperboard: () => null,
  Copy: () => null,
  Download: () => null,
  EllipsisVertical: () => null,
  Eye: () => null,
  FileArchive: () => null,
  FolderInput: () => null,
  FolderOpen: () => null,
  Link: () => null,
  Info: () => null,
  Pencil: () => null,
  ArrowRightLeft: () => null,
  RefreshCw: () => null,
  Share2: () => null,
  Sparkles: () => null,
  Trash2: () => null,
  X: () => null,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: React.MouseEventHandler }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: React.MouseEventHandler }) => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: test mock
    // biome-ignore lint/a11y/useFocusableInteractive: test mock
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => (
    <div role="menuitem" tabIndex={0}>
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: React.MouseEventHandler }) => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: test mock
    // biome-ignore lint/a11y/useFocusableInteractive: test mock
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
  ContextMenuSeparator: () => <hr />,
  ContextMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuSubTrigger: ({ children }: { children: React.ReactNode }) => (
    <div role="menuitem" tabIndex={0}>
      {children}
    </div>
  ),
}))

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
    trashedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// Rendering tests
// ---------------------------------------------------------------------------

afterEach(cleanup)

describe('FileRowActions — component rendering', () => {
  it('includes open in the row action menu so it matches the context menu', () => {
    const item = makeObject()
    const onOpen = vi.fn()
    const handlers = { onOpen } as unknown as FileActionHandlers
    const { getByRole } = render(<FileRowActions item={item} handlers={handlers} />)

    const openItem = getByRole('menuitem', { name: 'files.preview' })
    fireEvent.click(openItem)

    expect(onOpen).toHaveBeenCalledWith(item)
  })

  it('renders dropdown when onCopyUrl is provided', () => {
    const item = makeObject()
    const handlers = { onOpen: vi.fn(), onCopyUrl: vi.fn() } as unknown as FileActionHandlers
    const { container } = render(<FileRowActions item={item} handlers={handlers} />)
    expect(container.firstChild).not.toBeNull()
  })

  it('renders the same complete action set in row and context menus', () => {
    const item = { ...makeObject(), name: 'archive.zip' }
    const handlers: FileActionHandlers = {
      onOpen: vi.fn(),
      onDetails: vi.fn(),
      onDownload: vi.fn(),
      onCopyUrl: vi.fn(),
      onRename: vi.fn(),
      onCopy: vi.fn(),
      onMove: vi.fn(),
      onTransfer: vi.fn(),
      onShare: vi.fn(),
      onCompress: vi.fn(),
      onExtract: vi.fn(),
      onTrash: vi.fn(),
      onDelete: vi.fn(),
    }

    const rowView = render(<FileRowActions item={item} handlers={handlers} />)
    const rowActions = rowView.getAllByRole('menuitem').map((element) => element.textContent)
    cleanup()

    const contextView = render(<FileActionsContextContent item={item} handlers={handlers} />)
    const contextActions = contextView.getAllByRole('menuitem').map((element) => element.textContent)

    expect(contextActions).toEqual(rowActions)
    expect(contextActions).toEqual([
      'files.details',
      'files.preview',
      'files.download',
      'ihost.copy.url',
      'ihost.copy.raw',
      'ihost.copy.markdown',
      'ihost.copy.html',
      'ihost.copy.bbcode',
      'files.rename',
      'files.copy',
      'files.moveTo',
      'files.transferToSpace',
      'share.menuItem',
      'files.compress',
      'files.extract',
      'files.moveToTrash',
      'common.delete',
    ])
  })

  it('renders dropdown when onDelete is provided', () => {
    const item = makeObject()
    const handlers = { onOpen: vi.fn(), onDelete: vi.fn() } as unknown as FileActionHandlers
    const { container } = render(<FileRowActions item={item} handlers={handlers} />)
    expect(container.firstChild).not.toBeNull()
  })

  it('calls onCopyUrl with "raw" when raw menu item clicked', () => {
    const onCopyUrl = vi.fn()
    const item = makeObject()
    const handlers = { onOpen: vi.fn(), onCopyUrl } as unknown as FileActionHandlers
    const { getAllByRole } = render(<FileRowActions item={item} handlers={handlers} />)
    const menuItems = getAllByRole('menuitem')
    const rawItem = menuItems.find((el: HTMLElement) => el.textContent === 'ihost.copy.raw')
    expect(rawItem).toBeDefined()
    fireEvent.click(rawItem!)
    expect(onCopyUrl).toHaveBeenCalledWith(item, 'raw')
  })

  it('calls onCopyUrl with "markdown" when markdown menu item clicked', () => {
    const onCopyUrl = vi.fn()
    const item = makeObject()
    const handlers = { onOpen: vi.fn(), onCopyUrl } as unknown as FileActionHandlers
    const { getAllByRole } = render(<FileRowActions item={item} handlers={handlers} />)
    const menuItems = getAllByRole('menuitem')
    const mdItem = menuItems.find((el: HTMLElement) => el.textContent === 'ihost.copy.markdown')
    expect(mdItem).toBeDefined()
    fireEvent.click(mdItem!)
    expect(onCopyUrl).toHaveBeenCalledWith(item, 'markdown')
  })

  it('calls onCopyUrl with "html" when html menu item clicked', () => {
    const onCopyUrl = vi.fn()
    const item = makeObject()
    const handlers = { onOpen: vi.fn(), onCopyUrl } as unknown as FileActionHandlers
    const { getAllByRole } = render(<FileRowActions item={item} handlers={handlers} />)
    const menuItems = getAllByRole('menuitem')
    const htmlItem = menuItems.find((el: HTMLElement) => el.textContent === 'ihost.copy.html')
    expect(htmlItem).toBeDefined()
    fireEvent.click(htmlItem!)
    expect(onCopyUrl).toHaveBeenCalledWith(item, 'html')
  })

  it('calls onCopyUrl with "bbcode" when bbcode menu item clicked', () => {
    const onCopyUrl = vi.fn()
    const item = makeObject()
    const handlers = { onOpen: vi.fn(), onCopyUrl } as unknown as FileActionHandlers
    const { getAllByRole } = render(<FileRowActions item={item} handlers={handlers} />)
    const menuItems = getAllByRole('menuitem')
    const bbItem = menuItems.find((el: HTMLElement) => el.textContent === 'ihost.copy.bbcode')
    expect(bbItem).toBeDefined()
    fireEvent.click(bbItem!)
    expect(onCopyUrl).toHaveBeenCalledWith(item, 'bbcode')
  })

  it('calls onDelete with the item when delete menu item clicked', () => {
    const onDelete = vi.fn()
    const item = makeObject()
    const handlers = { onOpen: vi.fn(), onDelete } as unknown as FileActionHandlers
    const { getAllByRole } = render(<FileRowActions item={item} handlers={handlers} />)
    const menuItems = getAllByRole('menuitem')
    const deleteItem = menuItems.find((el: HTMLElement) => el.textContent === 'common.delete')
    expect(deleteItem).toBeDefined()
    fireEvent.click(deleteItem!)
    expect(onDelete).toHaveBeenCalledWith(item)
  })

  it('does not render download item for folder items', () => {
    const item = makeObject(DirType.USER_FOLDER)
    const handlers = { onOpen: vi.fn(), onDownload: vi.fn(), onDelete: vi.fn() } as unknown as FileActionHandlers
    const { queryAllByRole } = render(<FileRowActions item={item} handlers={handlers} />)
    const menuItems = queryAllByRole('menuitem')
    const downloadItem = menuItems.find((el: HTMLElement) => el.textContent === 'files.download')
    expect(downloadItem).toBeUndefined()
  })

  it('renders download item for file items', () => {
    const onDownload = vi.fn()
    const item = makeObject(DirType.FILE)
    const handlers = { onOpen: vi.fn(), onDownload } as unknown as FileActionHandlers
    const { getAllByRole } = render(<FileRowActions item={item} handlers={handlers} />)
    const menuItems = getAllByRole('menuitem')
    const downloadItem = menuItems.find((el: HTMLElement) => el.textContent === 'files.download')
    expect(downloadItem).toBeDefined()
    fireEvent.click(downloadItem!)
    expect(onDownload).toHaveBeenCalledWith(item)
  })

  it('renders extract only for zip files', () => {
    const onExtract = vi.fn()
    const zip = { ...makeObject(DirType.FILE), name: 'backup.zip' }
    const text = { ...makeObject(DirType.FILE), name: 'notes.txt' }
    const handlers = { onOpen: vi.fn(), onExtract } as unknown as FileActionHandlers

    const zipView = render(<FileRowActions item={zip} handlers={handlers} />)
    expect(zipView.getAllByRole('menuitem').some((el) => el.textContent === 'files.extract')).toBe(true)
    cleanup()

    const textView = render(<FileRowActions item={text} handlers={handlers} />)
    expect(textView.queryAllByRole('menuitem').some((el) => el.textContent === 'files.extract')).toBe(false)
  })

  it('calls onCompress when compress item clicked', () => {
    const onCompress = vi.fn()
    const item = makeObject(DirType.USER_FOLDER)
    const handlers = { onOpen: vi.fn(), onCompress } as unknown as FileActionHandlers
    const { getAllByRole } = render(<FileRowActions item={item} handlers={handlers} />)
    const compressItem = getAllByRole('menuitem').find((el: HTMLElement) => el.textContent === 'files.compress')
    expect(compressItem).toBeDefined()
    fireEvent.click(compressItem!)
    expect(onCompress).toHaveBeenCalledWith(item)
  })

  it('offers media library actions on folders only, following the folder state [spec: media-scraping/folder-menu]', () => {
    const folder = makeObject(DirType.USER_FOLDER)
    const library = { id: 'lib-1', folderId: folder.id } as ReturnType<MediaLibraryActions['libraryFor']>
    const actions = (overrides: Partial<MediaLibraryActions>): MediaLibraryActions => ({
      locked: false,
      libraryFor: () => undefined,
      onSet: vi.fn(),
      onRemove: vi.fn(),
      onRescan: vi.fn(),
      onScrape: vi.fn(),
      ...overrides,
    })
    const labels = (item: StorageObject, mediaLibrary: MediaLibraryActions) => {
      const view = render(<FileRowActions item={item} handlers={{ onOpen: vi.fn(), mediaLibrary }} />)
      const items = view.getAllByRole('menuitem')
      return { items, text: items.map((el) => el.textContent) }
    }

    const plain = actions({})
    const unmarked = labels(folder, plain)
    expect(unmarked.text).toContain('mediaLibrary.set')
    fireEvent.click(unmarked.items.find((el) => el.textContent === 'mediaLibrary.set')!)
    expect(plain.onSet).toHaveBeenCalledWith(folder)
    cleanup()

    const marked = actions({ libraryFor: () => library })
    const markedView = labels(folder, marked)
    expect(markedView.text).not.toContain('mediaLibrary.set')
    fireEvent.click(markedView.items.find((el) => el.textContent === 'mediaLibrary.rescan')!)
    fireEvent.click(markedView.items.find((el) => el.textContent === 'mediaLibrary.scrape')!)
    fireEvent.click(markedView.items.find((el) => el.textContent === 'mediaLibrary.remove')!)
    expect(marked.onRescan).toHaveBeenCalledWith(library)
    expect(marked.onScrape).toHaveBeenCalledWith(library)
    expect(marked.onRemove).toHaveBeenCalledWith(library)
    cleanup()

    expect(labels(folder, actions({ locked: true })).text).toContain('mediaLibrary.setPro')
    cleanup()

    const lapsed = actions({ locked: true, libraryFor: () => library })
    const lapsedView = labels(folder, lapsed)
    expect(lapsedView.text).toEqual(
      expect.arrayContaining(['mediaLibrary.rescanPro', 'mediaLibrary.scrapePro', 'mediaLibrary.remove']),
    )
    fireEvent.click(lapsedView.items.find((el) => el.textContent === 'mediaLibrary.remove')!)
    expect(lapsed.onRemove).toHaveBeenCalledWith(library)
    cleanup()

    expect(labels(makeObject(DirType.FILE), plain).text.some((text) => text?.startsWith('mediaLibrary.'))).toBe(false)
  })
})
