import { SignupMode } from '@shared/constants'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCloudStoreSettings, setSystemOption, updateCloudStoreSettings } from '@/lib/api'
import { SettingsPage } from './index'

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

vi.mock('@/components/admin/branding-section', () => ({
  BrandingSection: () => <section>branding</section>,
}))

vi.mock('@/hooks/use-site-options', () => ({
  siteOptionsQueryKey: ['system', 'options'],
  useSiteOptions: () => ({
    siteName: 'ZPan',
    siteDescription: 'File hosting',
    defaultOrgQuota: 1073741824,
    authSignupMode: SignupMode.OPEN,
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({
    hasFeature: () => true,
  }),
}))

vi.mock('@/lib/api', () => ({
  getCloudStoreSettings: vi.fn(),
  setSystemOption: vi.fn(),
  updateCloudStoreSettings: vi.fn(),
}))

function renderSettingsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsPage', () => {
  it('updates storage plans from the storage settings section', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    vi.mocked(getCloudStoreSettings).mockResolvedValue({
      id: 'settings-1',
      enabled: false,
      status: 'ready',
      createdAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:00:00.000Z',
    })
    vi.mocked(updateCloudStoreSettings).mockResolvedValue({
      id: 'settings-1',
      enabled: true,
      status: 'ready',
      createdAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:00:00.000Z',
    })

    const view = renderSettingsPage()

    const storagePlansSwitch = await view.findByRole('switch', { name: 'admin.settings.cloudStoreEnabled' })
    await waitFor(() => expect(storagePlansSwitch.hasAttribute('disabled')).toBe(false))
    expect(storagePlansSwitch.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(storagePlansSwitch)
    await waitFor(() => expect(storagePlansSwitch.getAttribute('aria-checked')).toBe('true'))
    expect(updateCloudStoreSettings).not.toHaveBeenCalled()

    const saveButtons = view.getAllByRole('button', { name: 'common.save' })
    fireEvent.click(saveButtons[saveButtons.length - 1])

    await waitFor(() => expect(setSystemOption).toHaveBeenCalledWith('default_org_quota', '1073741824', false))
    await waitFor(() => expect(updateCloudStoreSettings).toHaveBeenCalledWith({ enabled: true }))
    expect(toast.success).toHaveBeenCalledWith('admin.settings.saved')
  })
})
