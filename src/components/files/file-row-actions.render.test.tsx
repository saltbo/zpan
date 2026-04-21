// Rendering tests for src/components/files/file-row-actions.tsx
// Covers the JSX branches: dropdown render, CopyUrl sub-menu, onDelete.
import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileRowActions } from './file-row-actions'
import type { FileActionHandlers } from './types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('lucide-react', () => ({
  Copy: () => null,
  Download: () => null,
  EllipsisVertical: () => null,
  FolderInput: () => null,
  Link: () => null,
  Pencil: () => null,
  Share2: () => null,
  Trash2: () => null,
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
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// Rendering tests
// ---------------------------------------------------------------------------

afterEach(cleanup)

describe('FileRowActions — component rendering', () => {
  it('renders nothing when no action handlers provided (only onOpen)', () => {
    const item = makeObject()
    const handlers = { onOpen: vi.fn() } as unknown as FileActionHandlers
    const { container } = render(<FileRowActions item={item} handlers={handlers} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders dropdown when onCopyUrl is provided', () => {
    const item = makeObject()
    const handlers = { onOpen: vi.fn(), onCopyUrl: vi.fn() } as unknown as FileActionHandlers
    const { container } = render(<FileRowActions item={item} handlers={handlers} />)
    expect(container.firstChild).not.toBeNull()
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
})
