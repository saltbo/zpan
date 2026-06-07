import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
} from '@shared/captcha'
import { SignupMode } from '@shared/constants'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSystemOption } from '@/lib/api'
import { SettingsPage } from './index'

const siteOptionsState = vi.hoisted(() => ({
  current: {
    siteName: 'ZPan',
    siteDescription: 'File hosting',
    defaultOrgQuota: 1073741824,
    authSignupMode: 'open',
    captchaEnabled: false,
    captchaProvider: 'cloudflare-turnstile',
    captchaSiteKey: '',
    captchaSecretKey: '',
    captchaMinScore: '',
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
  setSystemOption: vi.fn(),
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
    captchaProvider: 'cloudflare-turnstile',
    captchaSiteKey: '',
    captchaSecretKey: '',
    captchaMinScore: '',
    isLoading: false,
    isError: false,
  }
})

describe('SettingsPage', () => {
  it('saves identity settings from the identity section', async () => {
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
    const view = renderSettingsPage()
    const registrationSwitch = await view.findByRole('switch', { name: 'admin.settings.registrationLabel' })

    fireEvent.click(registrationSwitch)

    await waitFor(() => expect(setSystemOption).toHaveBeenCalledWith('auth_signup_mode', SignupMode.CLOSED, true))
    expect(toast.success).toHaveBeenCalledWith('admin.settings.saved')
  })

  it('updates the default storage quota from the storage settings section', async () => {
    const view = renderSettingsPage()

    const quotaInput = await view.findByLabelText('admin.settings.defaultOrgQuota')
    await waitFor(() => expect(quotaInput).toHaveProperty('value', '1'))
    fireEvent.change(quotaInput, { target: { value: '1' } })

    const storageSection = view.getByText('admin.settings.storageSection').closest('[data-slot="card"]')
    if (!storageSection) throw new Error('storage section not found')
    fireEvent.click(within(storageSection as HTMLElement).getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(setSystemOption).toHaveBeenCalledWith('default_org_quota', '1073741824', false))
    expect(toast.success).toHaveBeenCalledWith('admin.settings.saved')
  })

  it('saves captcha settings from the authentication protection section', async () => {
    const view = renderSettingsPage()

    fireEvent.change(await view.findByLabelText('admin.settings.captchaSiteKey'), {
      target: { value: 'site-key' },
    })
    fireEvent.change(view.getByLabelText('admin.settings.captchaSecretKey'), {
      target: { value: 'secret-key' },
    })
    fireEvent.click(view.getByRole('switch', { name: 'admin.settings.captchaEnabled' }))

    const saveButtons = view.getAllByRole('button', { name: 'common.save' })
    fireEvent.click(saveButtons[1])

    await waitFor(() =>
      expect(setSystemOption).toHaveBeenCalledWith(CAPTCHA_PROVIDER_KEY, 'cloudflare-turnstile', true),
    )
    expect(setSystemOption).toHaveBeenCalledWith(CAPTCHA_SITE_KEY_KEY, 'site-key', true)
    expect(setSystemOption).toHaveBeenCalledWith(CAPTCHA_SECRET_OPTION_KEY, 'secret-key', false)
    expect(setSystemOption).toHaveBeenCalledWith(CAPTCHA_MIN_SCORE_KEY, '', false)
    expect(setSystemOption).toHaveBeenCalledWith(CAPTCHA_ENABLED_KEY, 'true', true)
    expect(toast.success).toHaveBeenCalledWith('admin.settings.saved')
  })
})
