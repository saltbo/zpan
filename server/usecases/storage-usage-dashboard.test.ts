import type { StorageUsageItem } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { listStorageUsageItems } from './storage-usage-dashboard'

describe('listStorageUsageItems', () => {
  it('delegates category pagination and sorting to the projection repository', async () => {
    const items: StorageUsageItem[] = [
      {
        id: 'file-1',
        name: 'photo.jpg',
        path: '/photo.jpg',
        parentPath: '/',
        type: 'image/jpeg',
        size: 1024,
        updatedAt: '2026-07-23T00:00:00.000Z',
        source: 'files',
      },
    ]
    const listItems = vi.fn().mockResolvedValue({ items, nextBoundary: null })
    const deps = {
      storageUsageBreakdowns: {
        get: vi.fn(),
        listItems,
      },
    } as unknown as Pick<Deps, 'storageUsageBreakdowns'>

    await expect(
      listStorageUsageItems(deps, 'org-1', {
        category: 'photos',
        pageSize: 10,
        sortBy: 'name',
        sortDir: 'asc',
        after: { value: 'b.png', id: 'f-1' },
      }),
    ).resolves.toEqual({ items, nextBoundary: null })
    expect(listItems).toHaveBeenCalledWith('org-1', {
      category: 'photos',
      pageSize: 10,
      sortBy: 'name',
      sortDir: 'asc',
      after: { value: 'b.png', id: 'f-1' },
    })
  })
})
