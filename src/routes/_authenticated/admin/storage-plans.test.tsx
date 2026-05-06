import type { QuotaStorePackage, QuotaStoreSettings } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
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
import { AdminStoragePlansPage } from './storage-plans'

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
    resourceType: 'storage',
    resourceBytes: 107374182400,
    prices: [{ currency: 'usd', amount: 999 }],
    active: true,
    sortOrder: 1,
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
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <AdminStoragePlansPage />
      </QueryClientProvider>
    </TooltipProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminStoragePlansPage', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    vi.mocked(listAdminQuotaDeliveryRecords).mockResolvedValue({ items: [], total: 0 })
  })

  it('shows the Pro gate when quota store settings are unavailable', async () => {
    vi.mocked(getQuotaStoreSettings).mockRejectedValue(new ApiError(402, { error: 'feature_not_available' }))
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('upgrade:quota_store')).toBeTruthy())
    expect(view.queryByRole('switch', { name: 'admin.storagePlans.enabled' })).toBeNull()
  })

  it('creates a package with the configured form values', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(createQuotaStorePackage).mockResolvedValue(quotaPackage({ id: 'pkg-2' }))

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'admin.storagePlans.newPackage' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'admin.storagePlans.newPackage' }))
    fireEvent.change(view.getByLabelText('admin.storagePlans.packageName'), { target: { value: '250 GB' } })
    fireEvent.change(view.getByLabelText('admin.storagePlans.description'), { target: { value: 'Team storage' } })
    fireEvent.change(view.getByLabelText('admin.storagePlans.size'), { target: { value: '250' } })
    fireEvent.change(view.getByLabelText('admin.storagePlans.usdAmount'), { target: { value: '1999' } })
    fireEvent.change(view.getByLabelText('admin.storagePlans.cnyAmount'), { target: { value: '12900' } })
    fireEvent.change(view.getByLabelText('admin.storagePlans.sortOrder'), { target: { value: '2' } })
    fireEvent.click(view.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(createQuotaStorePackage).toHaveBeenCalledWith({
        name: '250 GB',
        description: 'Team storage',
        resourceType: 'storage',
        resourceBytes: 268435456000,
        prices: [
          { currency: 'usd', amount: 1999 },
          { currency: 'cny', amount: 12900 },
        ],
        active: true,
        sortOrder: 2,
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('admin.storagePlans.packageSaved')
  })

  it('shows packages in a table and opens the package form in a dialog', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('table')).toBeTruthy())
    expect(view.getByRole('columnheader', { name: 'admin.storagePlans.packageName' })).toBeTruthy()
    expect(view.getByRole('columnheader', { name: 'admin.storagePlans.prices' })).toBeTruthy()
    expect(view.queryByLabelText('admin.storagePlans.packageName')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'admin.storagePlans.newPackage' }))

    const dialog = await view.findByRole('dialog')
    expect(within(dialog).getByText('admin.storagePlans.newPackage')).toBeTruthy()
    expect(within(dialog).getByLabelText('admin.storagePlans.packageName')).toBeTruthy()
  })

  it('opens existing packages for editing in the package dialog', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [quotaPackage({ name: '500 GB' })], total: 1 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'common.edit' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'common.edit' }))

    const dialog = await view.findByRole('dialog')
    expect(within(dialog).getByText('admin.storagePlans.editPackage')).toBeTruthy()
    expect(within(dialog).getByLabelText('admin.storagePlans.packageName')).toHaveProperty('value', '500 GB')
  })

  it('filters packages from the packages toolbar', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({
      items: [
        quotaPackage({ id: 'pkg-active', name: 'Active plan', active: true }),
        quotaPackage({ id: 'pkg-disabled', name: 'Disabled plan', active: false }),
      ],
      total: 2,
    })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('Active plan')).toBeTruthy())
    expect(view.getByText('Disabled plan')).toBeTruthy()

    fireEvent.click(view.getByRole('combobox'))
    fireEvent.click(await view.findByRole('option', { name: 'admin.storagePlans.packages.filterDisabled' }))

    expect(view.queryByText('Active plan')).toBeNull()
    expect(view.getByText('Disabled plan')).toBeTruthy()
  })

  it('shows operator-facing store status without technical Cloud fields', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('admin.storagePlans.storeStatus')).toBeTruthy())
    expect(view.getByText('admin.storagePlans.cloudConnection')).toBeTruthy()
    expect(view.queryByText('admin.storagePlans.storage.open')).toBeNull()
    expect(view.queryByText('admin.storagePlans.cloud.connected')).toBeNull()
    expect(view.queryByText('admin.storagePlans.cloudBaseUrl')).toBeNull()
    expect(view.queryByText('admin.storagePlans.callbackUrl')).toBeNull()
    expect(view.queryByText('admin.storagePlans.webhookSecret')).toBeNull()
  })

  it('keeps plan management available when front-end storage plans are disabled', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings({ enabled: false, status: 'ready' }))
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('admin.storagePlans.storeStatus')).toBeTruthy())
    expect(view.queryByText('admin.storagePlans.storage.closed')).toBeNull()
    expect(view.queryByText('admin.storagePlans.cloud.notConnected')).toBeNull()
    expect(view.getByRole('tablist')).toBeTruthy()
    expect(view.getByText('100 GB')).toBeTruthy()
    expect(view.queryByRole('switch', { name: 'admin.storagePlans.enabled' })).toBeNull()
    expect(view.queryByRole('button', { name: 'common.save' })).toBeNull()
    expect(view.queryByRole('button', { name: 'admin.storagePlans.sync' })).toBeNull()
    expect(listQuotaStorePackages).toHaveBeenCalled()
    expect(listAdminQuotaDeliveryRecords).toHaveBeenCalled()
    expect(updateQuotaStoreSettings).not.toHaveBeenCalled()
  })

  it('generates and revokes storage redemption codes from the codes tab', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listStorageRedemptionCodes).mockResolvedValue({
      items: [
        {
          code: 'ZS-CODE-1',
          resourceType: 'storage',
          resourceBytes: 107374182400,
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
    vi.mocked(revokeStorageRedemptionCode).mockResolvedValue({ code: 'ZS-CODE-1', deleted: true })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('tab', { name: 'admin.storagePlans.tabs.codes' })).toBeTruthy())
    fireEvent.click(view.getByRole('tab', { name: 'admin.storagePlans.tabs.codes' }))
    await waitFor(() => expect(view.getByText('ZS-CODE-1')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'admin.storagePlans.codes.generateTitle' }))
    fireEvent.change(view.getByLabelText('admin.storagePlans.size'), { target: { value: '50' } })
    fireEvent.change(view.getByLabelText('admin.storagePlans.codes.maxUses'), { target: { value: '2' } })
    fireEvent.change(view.getByLabelText('admin.storagePlans.codes.count'), { target: { value: '3' } })
    fireEvent.click(view.getByRole('button', { name: 'admin.storagePlans.codes.generate' }))

    await waitFor(() =>
      expect(generateStorageRedemptionCodes).toHaveBeenCalledWith({
        resourceType: 'storage',
        resourceBytes: 53687091200,
        maxUses: 2,
        count: 3,
      }),
    )
    fireEvent.click(view.getByRole('button', { name: 'admin.storagePlans.codes.revoke' }))
    expect(revokeStorageRedemptionCode).not.toHaveBeenCalled()

    const revokeDialog = await view.findByRole('dialog')
    expect(within(revokeDialog).getByText('admin.storagePlans.codes.revokeTitle')).toBeTruthy()
    fireEvent.click(within(revokeDialog).getByRole('button', { name: 'admin.storagePlans.codes.revoke' }))

    await waitFor(() => expect(revokeStorageRedemptionCode).toHaveBeenCalledWith('ZS-CODE-1', expect.anything()))
  })

  it('shows redemption codes in a table and opens generation fields in a dialog', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings())
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listStorageRedemptionCodes).mockResolvedValue({
      items: [
        {
          code: 'ZS-CODE-2',
          resourceType: 'traffic',
          resourceBytes: 53687091200,
          maxUses: 2,
          usesCount: 1,
          expiresAt: null,
          createdAt: '2026-05-05T00:00:00.000Z',
          revokedAt: null,
        },
      ],
      total: 1,
    })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('tab', { name: 'admin.storagePlans.tabs.codes' })).toBeTruthy())
    fireEvent.click(view.getByRole('tab', { name: 'admin.storagePlans.tabs.codes' }))

    await waitFor(() => expect(view.getByText('ZS-CODE-2')).toBeTruthy())
    expect(view.getByRole('table')).toBeTruthy()
    expect(view.getByRole('columnheader', { name: 'admin.storagePlans.codes.code' })).toBeTruthy()
    expect(view.queryByLabelText('admin.storagePlans.codes.count')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'admin.storagePlans.codes.generateTitle' }))

    const dialog = await view.findByRole('dialog')
    expect(within(dialog).getByText('admin.storagePlans.codes.generateTitle')).toBeTruthy()
    expect(within(dialog).getByLabelText('admin.storagePlans.codes.count')).toBeTruthy()
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

    await waitFor(() => expect(view.getByRole('tab', { name: 'admin.storagePlans.tabs.delivery' })).toBeTruthy())
    fireEvent.click(view.getByRole('tab', { name: 'admin.storagePlans.tabs.delivery' }))
    await waitFor(() => expect(view.getByText('user@example.com')).toBeTruthy())
  })

  it('shows a disabled store status before settings are created', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(null)
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('admin.storagePlans.storeStatus')).toBeTruthy())
  })
})
