import type { QuotaStorePackage, QuotaStoreSettings } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createQuotaStorePackage,
  getQuotaStoreSettings,
  listQuotaStorePackages,
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
    getQuotaStoreSettings: vi.fn(),
    listQuotaStorePackages: vi.fn(),
    updateQuotaStorePackage: vi.fn(),
    updateQuotaStoreSettings: vi.fn(),
  }
})

function settings(overrides: Partial<QuotaStoreSettings> = {}): QuotaStoreSettings {
  return {
    id: 'settings-1',
    enabled: true,
    cloudBaseUrl: 'https://cloud.example',
    publicInstanceUrl: 'https://zpan.example',
    webhookSigningSecretSet: true,
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

  it('normalizes the displayed callback URL', async () => {
    vi.mocked(getQuotaStoreSettings).mockResolvedValue(settings({ publicInstanceUrl: 'https://zpan.example//' }))
    vi.mocked(listQuotaStorePackages).mockResolvedValue({ items: [], total: 0 })

    const view = renderAdminPage()

    await waitFor(() =>
      expect(view.getByDisplayValue('https://zpan.example/api/quota-store/webhooks/cloud')).toBeTruthy(),
    )
  })
})
