import { DirType } from '@shared/constants'
import type { ObjectListItem } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listObjectsByPath } from '@/lib/api'
import { FolderTree } from './folder-tree'

const mocks = vi.hoisted(() => ({
  currentPath: 'parent/child',
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useSearch: () => ({ path: mocks.currentPath }),
}))

vi.mock('@/lib/api', () => ({
  listObjectsByPath: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  useActiveOrganization: () => ({ data: { id: 'org-1' } }),
}))

function folder(id: string, name: string, parent = '', hasChildren = false): ObjectListItem {
  return {
    id,
    orgId: 'org-1',
    alias: '',
    name,
    type: 'folder',
    size: 0,
    dirtype: DirType.USER_FOLDER,
    parent,
    object: '',
    storageId: 'storage-1',
    status: 'active',
    trashedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hasChildren,
  }
}

function page(items: ObjectListItem[]) {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 100,
  }
}

function renderFolderTree() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <FolderTree />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.currentPath = 'parent/child'
  vi.mocked(listObjectsByPath).mockImplementation(async (path) => {
    if (path === '') return page([folder('parent', 'parent', '', true)])
    if (path === 'parent') return page([folder('child', 'child', 'parent')])
    return page([])
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FolderTree', () => {
  it('loads every page of folders', async () => {
    mocks.currentPath = ''
    vi.mocked(listObjectsByPath).mockImplementation(async (path, requestedPage) => {
      if (path !== '') return page([])
      if (requestedPage === 1) {
        return {
          items: [folder('first', 'first')],
          total: 101,
          page: 1,
          pageSize: 100,
        }
      }
      return {
        items: [folder('last', 'last')],
        total: 101,
        page: 2,
        pageSize: 100,
      }
    })

    const view = renderFolderTree()
    await view.findByText('last')

    expect(listObjectsByPath).toHaveBeenNthCalledWith(1, '', 1, 100, { type: 'folder' })
    expect(listObjectsByPath).toHaveBeenNthCalledWith(2, '', 2, 100, { type: 'folder' })
  })

  it('loads only the root and expanded branches', async () => {
    mocks.currentPath = ''
    const view = renderFolderTree()

    await view.findByText('parent')

    expect(listObjectsByPath).toHaveBeenCalledTimes(1)
    expect(listObjectsByPath).toHaveBeenCalledWith('', 1, 100, { type: 'folder' })

    fireEvent.click(await view.findByRole('button', { name: 'parent' }))
    await view.findByText('child')

    expect(listObjectsByPath).toHaveBeenCalledTimes(2)
    expect(listObjectsByPath).toHaveBeenCalledWith('parent', 1, 100, { type: 'folder' })
    expect(view.queryByRole('button', { name: 'child' })).toBeNull()
  })

  it('allows the current path ancestor to be collapsed manually', async () => {
    const view = renderFolderTree()
    await view.findByText('child')
    const trigger = await view.findByRole('button', { name: 'parent' })

    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(trigger)

    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'))
    expect(view.queryByText('child')).toBeNull()
  })
})
