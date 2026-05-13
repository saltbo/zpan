import { CAPTCHA_ENABLED_KEY, CAPTCHA_SECRET_OPTION_KEY, CAPTCHA_SITE_KEY_KEY } from '@shared/captcha'
import { SignupMode } from '@shared/constants'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCloudStoreSettings, setSystemOption, updateCloudStoreSettings } from '@/lib/api'
import { SettingsPage } from './index'

const siteOptionsState = vi.hoisted(() => ({
  current: {
    siteName: 'ZPan',
    siteDescription: 'File hosting',
    defaultOrgQuota: 1073741824,
    authSignupMode: 'open',
    captchaEnabled: false,
    captchaSiteKey: '',
    captchaSecretKey: '',
    isLoading: false,
    isError: false,
  },
}))

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
  useSiteOptions: () => siteOptionsState.current,
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

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  siteOptionsState.current = {
    siteName: 'ZPan',
    siteDescription: 'File hosting',
    defaultOrgQuota: 1073741824,
    authSignupMode: SignupMode.OPEN,
    captchaEnabled: false,
    captchaSiteKey: '',
    captchaSecretKey: '',
    isLoading: false,
    isError: false,
  }
})

describe('SettingsPage', () => {
  it('saves identity settings from the identity section', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(null)

    const view = renderSettingsPage()
    await view.findByLabelText('admin.settings.siteName')

    fireEvent.change(view.getByLabelText('admin.settings.siteName'), {
      target: { value: 'New ZPan' },
    })
    fireEvent.change(view.getByLabelText('admin.settings.siteDescription'), {
      target: { value: 'Updated file hosting' },
    })

    fireEvent.click(view.getAllByRole('button', { name: 'common.save' })[0])

    await waitFor(() => expect(setSystemOption).toHaveBeenCalledWith('site_name', 'New ZPan', true))
    expect(setSystemOption).toHaveBeenCalledWith('site_description', 'Updated file hosting', true)
    expect(toast.success).toHaveBeenCalledWith('admin.settings.saved')
  })

  it('saves closed registration mode from the registration switch', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(null)

    const view = renderSettingsPage()
    const registrationSwitch = await view.findByRole('switch', { name: 'admin.settings.registrationLabel' })

    fireEvent.click(registrationSwitch)

    await waitFor(() => expect(setSystemOption).toHaveBeenCalledWith('auth_signup_mode', SignupMode.CLOSED, true))
    expect(toast.success).toHaveBeenCalledWith('admin.settings.saved')
  })

  it('updates storage plans from the storage settings section', async () => {
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

  it('saves captcha settings from the authentication protection section', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(null)

    const view = renderSettingsPage()
    const storagePlansSwitch = await view.findByRole('switch', { name: 'admin.settings.cloudStoreEnabled' })
    await waitFor(() => expect(storagePlansSwitch.hasAttribute('disabled')).toBe(false))

    fireEvent.change(await view.findByLabelText('admin.settings.captchaSiteKey'), {
      target: { value: 'site-key' },
    })
    fireEvent.change(view.getByLabelText('admin.settings.captchaSecretKey'), {
      target: { value: 'secret-key' },
    })
    fireEvent.click(view.getByRole('switch', { name: 'admin.settings.captchaEnabled' }))

    const saveButtons = view.getAllByRole('button', { name: 'common.save' })
    fireEvent.click(saveButtons[1])

    await waitFor(() => expect(setSystemOption).toHaveBeenCalledWith(CAPTCHA_SITE_KEY_KEY, 'site-key', true))
    expect(setSystemOption).toHaveBeenCalledWith(CAPTCHA_SECRET_OPTION_KEY, 'secret-key', false)
    expect(setSystemOption).toHaveBeenCalledWith(CAPTCHA_ENABLED_KEY, 'true', true)
    expect(toast.success).toHaveBeenCalledWith('admin.settings.saved')
  })
})
