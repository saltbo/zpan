import { ObjectStatus, StorageStatus, StorageStatusReason } from '@shared/constants'
import type { Storage } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  abortObjectUpload,
  type CreateObjectResult,
  createObject,
  listStorages,
  patchStorage,
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
  ApiError: class ApiError extends Error {},
  abortObjectUpload: vi.fn(),
  createObject: vi.fn(),
  listStorages: vi.fn(),
  patchStorage: vi.fn(),
  updateStorageEgressBilling: vi.fn(),
}))

vi.mock('@/lib/eplist', () => ({
  eplistProviderLabel: (providers: Array<{ slug: string; displayName: string }>, provider: string) =>
    providers.find((item) => item.slug === provider)?.displayName ?? provider,
  listEplistProviders: vi.fn(async () => [{ slug: 'aws-s3', displayName: 'Amazon S3', file: 's3.yml' }]),
}))

const storage: Storage = {
  id: 'storage-1',
  provider: 'aws-s3',
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
  enabled: true,
  status: StorageStatus.HEALTHY,
  statusReason: null,
  statusCheckedAt: '2026-01-01T00:00:00.000Z',
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
  it('shows concise storage details without exposing credentials', async () => {
    vi.mocked(listStorages).mockResolvedValue({ items: [storage], total: 1 })

    const view = renderStoragesPage()

    expect(await view.findByText('bucket')).toBeTruthy()
    expect(await view.findByText('Amazon S3')).toBeTruthy()
    expect(screen.queryByText('access-key')).toBeNull()
  })

  it('colors capacity independently from connection health', async () => {
    vi.mocked(listStorages).mockResolvedValue({
      items: [
        {
          ...storage,
          capacity: 100,
          used: 95,
          status: StorageStatus.UNHEALTHY,
          statusReason: StorageStatusReason.NETWORK_ERROR,
        },
      ],
      total: 1,
    })

    const view = renderStoragesPage()

    expect((await view.findByTestId('storage-usage-ring')).classList.contains('text-amber-500')).toBe(true)
  })

  it('shows used and total capacity on one line with a shared unit', async () => {
    vi.mocked(listStorages).mockResolvedValue({
      items: [{ ...storage, capacity: 500 * 1024 ** 2, used: 302.4 * 1024 ** 2 }],
      total: 1,
    })

    const view = renderStoragesPage()
    const detail = await view.findByTestId('storage-usage-detail')

    expect(detail.textContent).toBe('302.4 / 500 MB')
    expect(detail.classList.contains('whitespace-nowrap')).toBe(true)
  })

  it('keeps editing out of the overflow menu and exposes capacity billing', async () => {
    vi.mocked(listStorages).mockResolvedValue({ items: [storage], total: 1 })

    const view = renderStoragesPage()
    fireEvent.pointerDown(await view.findByRole('button', { name: 'admin.storages.cardActions' }), { button: 0 })

    expect(await view.findByRole('menuitem', { name: 'admin.storages.capacityBilling' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'common.edit' })).toBeNull()
  })

  it('leaves the provider cell empty when storage has no provider value', async () => {
    vi.mocked(listStorages).mockResolvedValue({ items: [{ ...storage, provider: '' }], total: 1 })

    const view = renderStoragesPage()

    expect(await view.findByText('bucket')).toBeTruthy()
    expect(screen.queryByText('admin.storages.providerCustom')).toBeNull()
  })

  it('creates a storage-targeted object, PUTs to S3, renders success, and cleans up strictly', async () => {
    vi.mocked(listStorages).mockResolvedValue({ items: [storage], total: 1 })
    vi.mocked(createObject).mockResolvedValue(uploadDraft)
    vi.mocked(abortObjectUpload).mockResolvedValue(undefined)
    vi.mocked(patchStorage).mockResolvedValue(storage)
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const view = renderStoragesPage()
    fireEvent.pointerDown(await view.findByRole('button', { name: 'admin.storages.cardActions' }), { button: 0 })
    fireEvent.click(await view.findByRole('menuitem', { name: 'admin.storages.testAction' }))

    await view.findByText('admin.storages.testDialogTitle')
    expect(screen.getByText('admin.storages.testStepCreate')).toBeTruthy()
    expect(screen.getByText('admin.storages.testStepUpload')).toBeTruthy()
    expect(screen.getByText('admin.storages.testStepCleanup')).toBeTruthy()
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
    expect(patchStorage).toHaveBeenCalledWith('storage-1', { status: 'healthy', statusReason: null })
  })

  it('renders current-origin CORS guidance when the browser cannot reach the presigned URL', async () => {
    vi.mocked(listStorages).mockResolvedValue({ items: [storage], total: 1 })
    vi.mocked(createObject).mockResolvedValue(uploadDraft)
    vi.mocked(abortObjectUpload).mockResolvedValue(undefined)
    vi.mocked(patchStorage).mockResolvedValue(storage)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const view = renderStoragesPage()
    fireEvent.pointerDown(await view.findByRole('button', { name: 'admin.storages.cardActions' }), { button: 0 })
    fireEvent.click(await view.findByRole('menuitem', { name: 'admin.storages.testAction' }))

    await view.findByText('admin.storages.testCorsFailure')
    expect(screen.getByTestId('storage-test-step-creating').dataset.state).toBe('done')
    expect(screen.getByTestId('storage-test-step-uploading').dataset.state).toBe('failed')
    expect(screen.getByTestId('storage-test-step-cleanup').dataset.state).toBe('pending')
    expect(document.body.textContent).toContain('admin.storages.testCorsCaveat')
    expect(document.body.textContent).toContain(window.location.origin)
    expect(document.body.textContent).toContain('"AllowedMethods": [')
    expect(document.body.textContent).toContain('"GET"')
    expect(document.body.textContent).toContain('"PUT"')
    expect(document.body.textContent).toContain('"POST"')
    expect(document.body.textContent).toContain('"HEAD"')
    expect(document.body.textContent).toContain('"MaxAgeSeconds": 3600')
    expect(abortObjectUpload).toHaveBeenCalledWith('object-1', 'session-1', { strictStorageCleanup: true })
  })

  it('runs a health check after enabling a storage and keeps it enabled when the check fails', async () => {
    const disabled = {
      ...storage,
      enabled: false,
      status: StorageStatus.UNHEALTHY,
      statusReason: StorageStatusReason.UNKNOWN,
    }
    vi.mocked(listStorages).mockResolvedValue({ items: [disabled], total: 1 })
    vi.mocked(patchStorage).mockImplementation(async (_id, input) => ({
      ...disabled,
      enabled: input.enabled ?? true,
      status: input.status ?? disabled.status,
    }))
    vi.mocked(createObject).mockRejectedValue(new Error('connection failed'))

    const view = renderStoragesPage()
    fireEvent.pointerDown(await view.findByRole('button', { name: 'admin.storages.cardActions' }), { button: 0 })
    fireEvent.click(await view.findByRole('menuitem', { name: 'admin.storages.enableAction' }))

    await waitFor(() => expect(patchStorage).toHaveBeenCalledWith('storage-1', { enabled: true }))
    await waitFor(() => expect(createObject).toHaveBeenCalled())
    await waitFor(() =>
      expect(patchStorage).toHaveBeenCalledWith('storage-1', {
        status: 'unhealthy',
        statusReason: 'unknown',
      }),
    )
  })

  it('opens egress billing from the row action and saves through the dedicated wrapper', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.mocked(listStorages).mockResolvedValue({ items: [{ ...storage, egressCreditBillingEnabled: true }], total: 1 })
    vi.mocked(patchStorage).mockResolvedValue(storage)
    vi.mocked(updateStorageEgressBilling).mockResolvedValue(storage)

    const view = renderStoragesPage()
    fireEvent.pointerDown(await view.findByRole('button', { name: 'admin.storages.cardActions' }), { button: 0 })
    fireEvent.click(await view.findByRole('menuitem', { name: 'admin.storages.capacityBilling' }))
    await view.findByText('admin.storages.billingTitle')
    fireEvent.change(screen.getByLabelText('admin.storages.fieldCapacity'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('admin.storages.egressBillingCredits'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(patchStorage).toHaveBeenCalledWith('storage-1', { capacity: 2 * 1024 * 1024 * 1024 }))
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
    vi.mocked(patchStorage).mockResolvedValue(storage)

    const view = renderStoragesPage()
    fireEvent.pointerDown(await view.findByRole('button', { name: 'admin.storages.cardActions' }), { button: 0 })
    fireEvent.click(await view.findByRole('menuitem', { name: 'admin.storages.capacityBilling' }))

    await view.findByText('admin.storages.egressBillingBusinessOnly')
    expect(screen.getByLabelText('admin.storages.egressBillingUnit')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('admin.storages.egressBillingCredits')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('admin.storages.fieldCapacity'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(patchStorage).toHaveBeenCalledWith('storage-1', { capacity: 3 * 1024 * 1024 * 1024 }))
    expect(updateStorageEgressBilling).not.toHaveBeenCalled()
  })
})
