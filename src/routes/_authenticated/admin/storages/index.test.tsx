import { ObjectStatus, StorageStatus } from '@shared/constants'
import type { Storage } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  abortObjectUpload,
  type CreateObjectResult,
  createObject,
  listStorages,
  updateStorageEgressBilling,
} from '@/lib/api'
import { corsJsonForOrigin, StoragesPage } from './index'

const mockHasFeature = vi.hoisted(() => vi.fn((_feature: string) => true))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      if (!values) return key
      return Object.entries(values).reduce((message, [name, value]) => message.replace(`{{${name}}}`, value), key)
    },
  }),
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: () => <div>upgrade-hint</div>,
}))

vi.mock('@/components/admin/delete-storage-dialog', () => ({
  DeleteStorageDialog: () => <div>delete-storage-dialog</div>,
}))

vi.mock('@/components/admin/storage-form-drawer', () => ({
  StorageFormDrawer: () => <div>storage-form-drawer</div>,
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({
    hasFeature: mockHasFeature,
  }),
}))

vi.mock('@/lib/api', () => ({
  abortObjectUpload: vi.fn(),
  createObject: vi.fn(),
  listStorages: vi.fn(),
  updateStorageEgressBilling: vi.fn(),
}))

const storage: Storage = {
  id: 'storage-1',
  title: 'Primary storage',
  bucket: 'bucket',
  endpoint: 'https://s3.example.com',
  region: 'auto',
  accessKey: 'access-key',
  secretKey: 'secret-key',
  filePath: '',
  customHost: null,
  capacity: 0,
  forcePathStyle: true,
  egressCreditBillingEnabled: false,
  egressCreditUnitBytes: 1073741824,
  egressCreditPerUnit: 1,
  used: 0,
  status: StorageStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const uploadDraft: CreateObjectResult = {
  id: 'object-1',
  orgId: 'org-1',
  alias: 'alias-1',
  name: '.zpan-storage-test.txt',
  type: 'text/plain',
  size: 29,
  dirtype: 0,
  parent: '',
  object: 'tests/object-1',
  storageId: 'storage-1',
  status: ObjectStatus.DRAFT,
  trashedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  upload: { sessionId: 'session-1', urls: ['https://uploads.example.com/object-1'], partSize: 5_242_880 },
}

function renderStoragesPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <StoragesPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

beforeEach(() => {
  mockHasFeature.mockReturnValue(true)
})

describe('admin storages CORS guidance', () => {
  it('renders the bucket CORS policy required for browser-based storage tests', () => {
    expect(JSON.parse(corsJsonForOrigin('https://preview.example.com'))).toEqual([
      {
        AllowedOrigins: ['https://preview.example.com'],
        AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3600,
      },
    ])
  })
})

describe('StoragesPage connection test action', () => {
  it('creates a storage-targeted object, PUTs to S3, renders success, and cleans up strictly', async () => {
    vi.mocked(listStorages).mockResolvedValue({ items: [storage], total: 1 })
    vi.mocked(createObject).mockResolvedValue(uploadDraft)
    vi.mocked(abortObjectUpload).mockResolvedValue(undefined)
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const view = renderStoragesPage()
    fireEvent.click(await view.findByTitle('admin.storages.testAction'))

    await waitFor(() =>
      expect(createObject).toHaveBeenCalledWith(
        expect.objectContaining({
          storageId: 'storage-1',
          name: expect.stringMatching(/^\.zpan-storage-test-\d+\.txt$/),
          type: 'text/plain',
          parent: '',
          dirtype: 0,
        }),
      ),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://uploads.example.com/object-1',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: expect.any(Blob),
      }),
    )
    await view.findByText('admin.storages.testSuccess')
    expect(abortObjectUpload).toHaveBeenCalledWith('object-1', 'session-1', { strictStorageCleanup: true })
  })

  it('renders current-origin CORS guidance when the browser cannot reach the presigned URL', async () => {
    vi.mocked(listStorages).mockResolvedValue({ items: [storage], total: 1 })
    vi.mocked(createObject).mockResolvedValue(uploadDraft)
    vi.mocked(abortObjectUpload).mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const view = renderStoragesPage()
    fireEvent.click(await view.findByTitle('admin.storages.testAction'))

    await view.findByText('admin.storages.testCorsFailure')
    expect(view.container.textContent).toContain('admin.storages.testCorsCaveat')
    expect(view.container.textContent).toContain(window.location.origin)
    expect(view.container.textContent).toContain('"AllowedMethods": [')
    expect(view.container.textContent).toContain('"GET"')
    expect(view.container.textContent).toContain('"PUT"')
    expect(view.container.textContent).toContain('"POST"')
    expect(view.container.textContent).toContain('"HEAD"')
    expect(view.container.textContent).toContain('"MaxAgeSeconds": 3600')
    expect(abortObjectUpload).toHaveBeenCalledWith('object-1', 'session-1', { strictStorageCleanup: true })
  })

  it('opens egress billing from the row action and saves through the dedicated wrapper', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.mocked(listStorages).mockResolvedValue({ items: [{ ...storage, egressCreditBillingEnabled: true }], total: 1 })
    vi.mocked(updateStorageEgressBilling).mockResolvedValue(storage)

    const view = renderStoragesPage()
    fireEvent.click(await view.findByTitle('admin.storages.configureEgressBilling'))
    await view.findByText('admin.storages.egressBillingTitle')
    fireEvent.change(screen.getByLabelText('admin.storages.egressBillingCredits'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(updateStorageEgressBilling).toHaveBeenCalledWith('storage-1', {
        enabled: true,
        unitBytes: 1024 * 1024 * 1024,
        creditsPerUnit: 4,
      }),
    )
  })

  it('shows egress billing as view-only without the quota store entitlement', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    mockHasFeature.mockImplementation((feature) => feature !== 'quota_store')
    vi.mocked(listStorages).mockResolvedValue({ items: [{ ...storage, egressCreditBillingEnabled: true }], total: 1 })

    const view = renderStoragesPage()
    fireEvent.click(await view.findByTitle('admin.storages.configureEgressBilling'))

    await view.findByText('admin.storages.egressBillingBusinessOnly')
    expect(screen.queryByRole('button', { name: 'common.save' })).toBeNull()
    expect(screen.getByLabelText('admin.storages.egressBillingCredits')).toHaveProperty('disabled', true)
    expect(screen.getAllByRole('button', { name: 'common.close' })).toHaveLength(2)

    expect(updateStorageEgressBilling).not.toHaveBeenCalled()
  })
})
