import type { QuotaStorePackage, QuotaStoreSettings } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createQuotaStorePackage,
  generateStorageRedemptionCodes,
  getQuotaStoreSettings,
  listAdminQuotaDeliveryRecords,
  listQuotaStorePackages,
  listStorageRedemptionCodes,
  revokeStorageRedemptionCode,
  updateQuotaStoreSettings,
} from '@/lib/api'
import { AdminQuotaStorePage } from './quota-store'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/components/ProBadge', () => ({
  ProBadge: () => <span>pro-badge</span>,
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: ({ feature }: { feature: string }) => <div>upgrade:{feature}</div>,
}))

vi.mock('@/lib/api', () => {
  class MockApiError extends Error {
    readonly status: number
    readonly body: Record<string, unknown>

    constructor(status: number, body: Record<string, unknown>) {
      super(String(body.error ?? `HTTP ${status}`))
      this.name = 'ApiError'
      this.status = status
      this.body = body
    }
  }

  return {
    ApiError: MockApiError,
    createQuotaStorePackage: vi.fn(),
    generateStorageRedemptionCodes: vi.fn(),
    getQuotaStoreSettings: vi.fn(),
    listAdminQuotaDeliveryRecords: vi.fn(),
    listQuotaStorePackages: vi.fn(),
    listStorageRedemptionCodes: vi.fn(),
    revokeStorageRedemptionCode: vi.fn(),
    syncQuotaStorePackages: vi.fn(),
    updateQuotaStorePackage: vi.fn(),
    updateQuotaStoreSettings: vi.fn(),
  }
})

function settings(overrides: Partial<QuotaStoreSettings> = {}): QuotaStoreSettings {
  return {
    id: 'settings-1',
    enabled: true,
    status: 'ready',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  }
}

function quotaPackage(overrides: Partial<QuotaStorePackage> = {}): QuotaStorePackage {
  return {
    id: 'pkg-1',
    name: '100 GB',
    description: 'Extra storage',
    bytes: 107374182400,
    amount: 999,
    currency: 'usd',
    active: true,
    sortOrder: 1,
    cloudPackageId: 'cloud-pkg-1',
    syncStatus: 'synced',
    syncError: null,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  }
}

function renderAdminPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AdminQuotaStorePage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminQuotaStorePage', () => {
  it('shows the Pro gate when quota store settings are unavailable', async () => {
    vi.mocked(getQuotaStoreSettings).mockRejectedValue(new ApiError(402, { error: 'feature_not_available' }))
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('upgrade:quota_store')).toBeTruthy())
    expect(view.getByRole('switch', { name: 'admin.quotaStore.enabled' }).hasAttribute('disabled')).toBe(true)
  })

  it('creates a package with the configured form values', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({
      items: [quotaPackage({ syncStatus: 'failed', syncError: 'sync failed' })],
      total: 1,
    })
    vi.mocked(createQuotaStorePackage).mockResolvedValue(quotaPackage({ id: 'pkg-2' }))
    vi.mocked(updateQuotaStoreSettings).mockResolvedValue(settings())

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('sync failed')).toBeTruthy())
    fireEvent.change(view.getByLabelText('admin.quotaStore.packageName'), { target: { value: '250 GB' } })
    fireEvent.change(view.getByLabelText('admin.quotaStore.description'), { target: { value: 'Team storage' } })
    fireEvent.change(view.getByLabelText('admin.quotaStore.size'), { target: { value: '250' } })
    fireEvent.change(view.getByLabelText('admin.quotaStore.amount'), { target: { value: '1999' } })
    fireEvent.change(view.getByLabelText('admin.quotaStore.sortOrder'), { target: { value: '2' } })
    fireEvent.click(view.getAllByRole('button', { name: 'common.save' })[1])

    await waitFor(() =>
      expect(createQuotaStorePackage).toHaveBeenCalledWith({
        name: '250 GB',
        description: 'Team storage',
        bytes: 268435456000,
        amount: 1999,
        currency: 'usd',
        active: true,
        sortOrder: 2,
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('admin.quotaStore.packageSaved')
  })

  it('shows operator-facing store status without technical Cloud fields', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('admin.quotaStore.status.ready')).toBeTruthy())
    expect(view.queryByText('admin.quotaStore.cloudBaseUrl')).toBeNull()
    expect(view.queryByText('admin.quotaStore.callbackUrl')).toBeNull()
    expect(view.queryByText('admin.quotaStore.webhookSecret')).toBeNull()
  })

  it('generates and revokes storage redemption codes from the codes tab', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listStorageRedemptionCodes).mockResolvedValue({
      items: [
        {
          code: 'ZS-CODE-1',
          bytes: 107374182400,
          maxUses: 1,
          usesCount: 0,
          expiresAt: null,
          createdAt: '2026-05-05T00:00:00.000Z',
          revokedAt: null,
        },
      ],
      total: 1,
    })
    vi.mocked(generateStorageRedemptionCodes).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(revokeStorageRedemptionCode).mockResolvedValue({ code: 'ZS-CODE-1', revoked: true })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'admin.quotaStore.tabs.codes' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'admin.quotaStore.tabs.codes' }))
    await waitFor(() => expect(view.getByText('ZS-CODE-1')).toBeTruthy())
    fireEvent.change(view.getByLabelText('admin.quotaStore.size'), { target: { value: '50' } })
    fireEvent.change(view.getByLabelText('admin.quotaStore.codes.maxUses'), { target: { value: '2' } })
    fireEvent.change(view.getByLabelText('admin.quotaStore.codes.count'), { target: { value: '3' } })
    fireEvent.click(view.getByRole('button', { name: 'admin.quotaStore.codes.generate' }))

    await waitFor(() =>
      expect(generateStorageRedemptionCodes).toHaveBeenCalledWith({
        bytes: 53687091200,
        maxUses: 2,
        count: 3,
      }),
    )
    fireEvent.click(view.getByRole('button', { name: 'admin.quotaStore.codes.revoke' }))
    await waitFor(() => expect(revokeStorageRedemptionCode).toHaveBeenCalledWith('ZS-CODE-1', expect.anything()))
  })

  it('loads delivery records from the delivery tab', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listAdminQuotaDeliveryRecords).mockResolvedValue({
      items: [
        {
          id: 'grant-1',
          orgId: 'org-1',
          source: 'redeem_code',
          externalEventId: 'evt-1',
          cloudOrderId: null,
          cloudRedemptionId: 'redemption-1',
          code: 'ZS-CODE-1',
          bytes: 1024,
          packageSnapshot: null,
          grantedBy: null,
          terminalUserId: 'user-1',
          terminalUserEmail: 'user@example.com',
          active: true,
          createdAt: '2026-05-05T00:00:00.000Z',
        },
      ],
      total: 1,
    })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'admin.quotaStore.tabs.delivery' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'admin.quotaStore.tabs.delivery' }))
    await waitFor(() => expect(view.getByText('user@example.com')).toBeTruthy())
  })

  it('shows a disabled store status before settings are created', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(null)
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('admin.quotaStore.status.store_disabled')).toBeTruthy())
  })
})
