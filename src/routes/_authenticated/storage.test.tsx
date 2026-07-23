import type { StorageUsageResponse } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteIhostImage,
  deleteObject,
  getStorageUsage,
  getUserQuota,
  listCloudProducts,
  listCloudStoreTargets,
  listStorageUsageItems,
  purgeTrashObject,
} from '@/lib/api'
import { StoragePage } from './storage'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${Object.values(values).join('/')}` : key),
    i18n: { resolvedLanguage: 'en' },
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))

vi.mock('@/lib/auth-client', () => ({
  useActiveOrganization: () => ({ data: { id: 'org-1' } }),
}))

vi.mock('@/lib/api', () => ({
  deleteIhostImage: vi.fn(),
  deleteObject: vi.fn(),
  getStorageUsage: vi.fn(),
  getUserQuota: vi.fn(),
  listCloudProducts: vi.fn(),
  listCloudStoreTargets: vi.fn(),
  listStorageUsageItems: vi.fn(),
  purgeTrashObject: vi.fn(),
}))

vi.mock('@/components/store/checkout-navigation', () => ({
  openCheckoutTab: vi.fn(),
  resolveCheckoutSelection: vi.fn(),
}))

const readyUsage: StorageUsageResponse = {
  usedBytes: 700,
  quotaBytes: 1000,
  currentPlan: { name: 'Plus', storageBytes: 1000, subscription: true },
  breakdowns: [
    { category: 'photos', bytes: 400, fileCount: 4 },
    { category: 'videos', bytes: 200, fileCount: 2 },
    { category: 'music', bytes: 0, fileCount: 0 },
    { category: 'documents', bytes: 50, fileCount: 1 },
    { category: 'archives', bytes: 0, fileCount: 0 },
    { category: 'other', bytes: 0, fileCount: 0 },
    { category: 'image_hosting', bytes: 25, fileCount: 1 },
    { category: 'trash', bytes: 25, fileCount: 1 },
  ],
  updatedAt: '2026-07-23T00:00:00.000Z',
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StoragePage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(getStorageUsage).mockResolvedValue(readyUsage)
  vi.mocked(getUserQuota).mockResolvedValue({
    orgId: 'org-1',
    baseQuota: 1000,
    entitlementQuota: 0,
    quota: 1000,
    used: 700,
    baseTrafficQuota: 0,
    entitlementTrafficQuota: 0,
    trafficQuota: 0,
    trafficUsed: 0,
    trafficPeriod: '2026-07',
    storagePlanName: 'Plus',
    storageExtraNames: [],
    trafficPlanName: null,
    trafficExtraNames: [],
    currentPlan: null,
  })
  vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(listCloudStoreTargets).mockResolvedValue({
    items: [{ orgId: 'org-1', name: 'Personal', type: 'personal', role: 'owner' }],
    total: 1,
  })
  vi.mocked(listStorageUsageItems).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  vi.mocked(deleteIhostImage).mockResolvedValue(undefined)
  vi.mocked(deleteObject).mockResolvedValue(undefined)
  vi.mocked(purgeTrashObject).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StoragePage', () => {
  it('renders the native usage summary, categories, plan, and trash', async () => {
    renderPage()
    expect(await screen.findByText(/Plus/)).toBeTruthy()
    expect(screen.getAllByText('storage.category.photos')).toHaveLength(2)
    expect(screen.getAllByText('storage.category.image_hosting')).toHaveLength(2)
    expect(screen.getAllByText('storage.category.trash')).toHaveLength(2)
    expect(screen.getByText('storage.spaceUsage')).toBeTruthy()
  })

  it('opens a category dialog and requests its files', async () => {
    renderPage()
    const photos = await screen.findAllByText('storage.category.photos')
    fireEvent.click(photos[1])
    await waitFor(() => expect(listStorageUsageItems).toHaveBeenCalledWith('photos', 1, 20, 'size', 'desc'))
    expect(screen.getByText('storage.manageFilesTitle')).toBeTruthy()
  })

  it('sorts the full category query from table headers', async () => {
    vi.mocked(listStorageUsageItems).mockResolvedValue({
      items: [
        {
          id: 'photo-1',
          name: 'one.jpg',
          type: 'image/jpeg',
          size: 100,
          updatedAt: '2026-07-23T00:00:00.000Z',
          source: 'files',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderPage()
    const photos = await screen.findAllByText('storage.category.photos')
    fireEvent.click(photos[1])
    fireEvent.click(await screen.findByText('storage.columnName'))

    await waitFor(() => expect(listStorageUsageItems).toHaveBeenCalledWith('photos', 1, 20, 'name', 'asc'))
    fireEvent.click(await screen.findByText('storage.columnName'))
    await waitFor(() => expect(listStorageUsageItems).toHaveBeenCalledWith('photos', 1, 20, 'name', 'desc'))
  })

  it('opens storage plans in a modal instead of the primary page', async () => {
    renderPage()
    const button = await screen.findByText('storage.expandStorage')
    await waitFor(() => expect(button.closest('button')?.disabled).toBe(false))
    fireEvent.click(button)
    expect(await screen.findAllByText('storage.availablePlansTitle')).toHaveLength(1)
    expect(screen.getAllByText('storage.availablePlansDescription')).toHaveLength(1)
    expect(screen.queryByText('storage.availableProductsDescription')).toBeNull()
  })

  it('selects multiple files and permanently deletes them without leaving the dialog', async () => {
    vi.mocked(listStorageUsageItems).mockResolvedValue({
      items: [
        {
          id: 'photo-1',
          name: 'one.jpg',
          type: 'image/jpeg',
          size: 100,
          updatedAt: '2026-07-23T00:00:00.000Z',
          source: 'files',
        },
        {
          id: 'photo-2',
          name: 'two.png',
          type: 'image/png',
          size: 200,
          updatedAt: '2026-07-23T00:00:00.000Z',
          source: 'files',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    })

    renderPage()
    const photos = await screen.findAllByText('storage.category.photos')
    fireEvent.click(photos[1])
    fireEvent.click(await screen.findByLabelText('storage.selectAll'))
    fireEvent.click(screen.getByText('storage.deleteSelected'))
    fireEvent.click(screen.getByText('storage.deletePermanently'))

    await waitFor(() => expect(deleteObject).toHaveBeenCalledTimes(2))
    expect(deleteObject).toHaveBeenNthCalledWith(1, 'photo-1')
    expect(deleteObject).toHaveBeenNthCalledWith(2, 'photo-2')
    expect(purgeTrashObject).toHaveBeenNthCalledWith(1, 'photo-1')
    expect(purgeTrashObject).toHaveBeenNthCalledWith(2, 'photo-2')
  })

  it.each([
    ['image_hosting', 'image_hosting', deleteIhostImage],
    ['trash', 'trash', purgeTrashObject],
  ] as const)('uses the correct delete path for %s items', async (category, source, deleteFn) => {
    vi.mocked(listStorageUsageItems).mockResolvedValue({
      items: [
        {
          id: `${category}-1`,
          name: `${category}.png`,
          type: 'image/png',
          size: 100,
          updatedAt: '2026-07-23T00:00:00.000Z',
          source,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    renderPage()
    const categoryLabels = await screen.findAllByText(`storage.category.${category}`)
    const categoryButton = categoryLabels.map((label) => label.closest('button')).find(Boolean)
    fireEvent.click(categoryButton!)
    fireEvent.click(await screen.findByLabelText(`storage.deleteFile:${category}.png`))
    fireEvent.click(screen.getByText('storage.deletePermanently'))

    await waitFor(() => expect(deleteFn).toHaveBeenCalledWith(`${category}-1`))
    expect(deleteObject).not.toHaveBeenCalled()
  })
})
