import { SignupMode } from '@shared/constants'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  updateSiteCaptcha,
  updateSiteIdentity,
  updateSiteQuotas,
  updateSiteRegistration,
  updateSiteWebDav,
  verifySiteWebDav,
} from '@/lib/api'
import { SettingsPage } from './index'

const state = vi.hoisted(() => ({
  whiteLabel: true,
  settings: {
    identity: { name: 'ZPan', description: 'File hosting', publicUrl: 'https://zpan.example.com' },
    registration: { configuredMode: 'open', effectiveMode: 'open' },
    captcha: {
      enabled: false,
      provider: 'cloudflare-turnstile',
      siteKey: '',
      secretConfigured: false,
      minScore: null,
    },
    quotas: {
      defaultOrgBytes: 1073741824,
      defaultTeamBytes: 1073741824,
      defaultMonthlyTrafficBytes: 0,
    },
    webdav: {
      enabled: true,
      domain: '',
      pathUrl: 'https://zpan.example.com/dav/',
      candidateUrl: 'https://dav.zpan.example.com/',
      status: 'unverified' as const,
      lastVerifiedAt: null,
      error: null,
    },
  },
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ProBadge', () => ({ ProBadge: () => <span>pro-badge</span> }))
vi.mock('@/components/admin/branding-section', () => ({ BrandingSection: () => <section>branding</section> }))
vi.mock('@/components/admin/email-config-section', () => ({
  EmailConfigSection: () => <section>email-config</section>,
}))
vi.mock('@/hooks/use-site-settings', () => ({
  siteSettingsQueryKey: ['site', 'settings'],
  useSiteSettings: () => ({ data: state.settings, isLoading: false }),
}))
vi.mock('@/hooks/use-site-config', () => ({ siteConfigQueryKey: ['site', 'config'] }))
vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({ hasFeature: (feature: string) => feature !== 'white_label' || state.whiteLabel }),
}))
vi.mock('@/lib/api', () => ({
  updateSiteIdentity: vi.fn(),
  updateSiteRegistration: vi.fn(),
  updateSiteWebDav: vi.fn(),
  updateSiteCaptcha: vi.fn(),
  updateSiteQuotas: vi.fn(),
  verifySiteWebDav: vi.fn(),
}))

function renderSettingsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  )
}

function openSection(view: ReturnType<typeof renderSettingsPage>, title: string, action = 'common.edit') {
  const section = view
    .getAllByText(title)
    .map((element) => element.closest('[data-settings-row]'))
    .find(Boolean)
  if (!section) throw new Error(`${title} section not found`)
  fireEvent.click(within(section as HTMLElement).getByRole('button', { name: action }))
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
  state.whiteLabel = true
})

describe('SettingsPage', () => {
  it('saves identity as one structured request', async () => {
    const view = renderSettingsPage()
    openSection(view, 'admin.settings.identityTitle')
    fireEvent.change(view.getByLabelText('admin.settings.siteName'), { target: { value: 'New ZPan' } })
    fireEvent.change(view.getByLabelText('admin.settings.siteDescription'), {
      target: { value: 'Updated file hosting' },
    })
    fireEvent.change(view.getByLabelText('admin.settings.sitePublicOrigin'), {
      target: { value: 'https://new.example.com' },
    })
    fireEvent.click(view.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(updateSiteIdentity).toHaveBeenCalledWith({
        name: 'New ZPan',
        description: 'Updated file hosting',
        publicUrl: 'https://new.example.com',
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('admin.settings.saved')
  })

  it('keeps Public URL editable when white-label fields are read-only', () => {
    state.whiteLabel = false
    const view = renderSettingsPage()
    openSection(view, 'admin.settings.identityTitle')

    expect(view.getByLabelText('admin.settings.siteName').hasAttribute('readonly')).toBe(true)
    expect(view.getByLabelText('admin.settings.siteDescription').hasAttribute('readonly')).toBe(true)
    expect(view.getByLabelText('admin.settings.sitePublicOrigin').hasAttribute('readonly')).toBe(false)
  })

  it('discards identity edits when cancelled', async () => {
    const view = renderSettingsPage()
    openSection(view, 'admin.settings.identityTitle')
    fireEvent.change(view.getByLabelText('admin.settings.siteName'), { target: { value: 'Draft ZPan' } })
    fireEvent.click(view.getByRole('button', { name: 'common.cancel' }))

    await waitFor(() => expect(view.queryByLabelText('admin.settings.siteName')).toBeNull())
    openSection(view, 'admin.settings.identityTitle')
    expect(view.getByLabelText('admin.settings.siteName')).toHaveProperty('value', 'ZPan')
    expect(updateSiteIdentity).not.toHaveBeenCalled()
  })

  it('updates registration through its dedicated mutation', async () => {
    const view = renderSettingsPage()
    openSection(view, 'admin.settings.registrationTitle')
    fireEvent.click(view.getByRole('switch', { name: 'admin.settings.registrationLabel' }))

    await waitFor(() => expect(updateSiteRegistration).toHaveBeenCalledWith({ mode: SignupMode.CLOSED }))
  })

  it('updates both storage quotas as one request', async () => {
    const view = renderSettingsPage()
    openSection(view, 'admin.settings.storageSection')
    fireEvent.change(view.getByLabelText('admin.settings.defaultOrgQuota'), { target: { value: '5' } })
    fireEvent.change(view.getByLabelText('admin.settings.defaultTeamQuota'), { target: { value: '10' } })
    fireEvent.click(view.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(updateSiteQuotas).toHaveBeenCalledWith({
        defaultOrgBytes: 5368709120,
        defaultTeamBytes: 10737418240,
        defaultMonthlyTrafficBytes: 0,
      }),
    )
  })

  it('updates captcha as one request and sends a newly entered secret', async () => {
    const view = renderSettingsPage()
    openSection(view, 'admin.settings.captchaTitle')
    fireEvent.change(view.getByLabelText('admin.settings.captchaSiteKey'), { target: { value: 'site-key' } })
    fireEvent.change(view.getByLabelText('admin.settings.captchaSecretKey'), { target: { value: 'secret-key' } })
    fireEvent.click(view.getByRole('switch', { name: 'admin.settings.captchaEnabled' }))
    fireEvent.click(view.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(updateSiteCaptcha).toHaveBeenCalledWith({
        enabled: true,
        provider: 'cloudflare-turnstile',
        siteKey: 'site-key',
        secretKey: 'secret-key',
        minScore: null,
      }),
    )
  })

  it('shows email configuration on the settings page', () => {
    expect(renderSettingsPage().getByText('email-config')).toBeTruthy()
  })

  it('verifies the derived WebDAV domain from its settings drawer', async () => {
    vi.mocked(verifySiteWebDav).mockResolvedValueOnce({
      ...state.settings.webdav,
      status: 'ready',
      lastVerifiedAt: '2026-07-20T12:00:00.000Z',
    })
    const view = renderSettingsPage()
    openSection(view, 'admin.settings.webdavTitle', 'admin.settings.webdavDetails')

    expect(view.getByLabelText('admin.settings.webdavCandidateUrl')).toHaveProperty(
      'value',
      'https://dav.zpan.example.com/',
    )
    fireEvent.click(view.getByRole('button', { name: 'admin.settings.webdavVerify' }))

    await waitFor(() => expect(verifySiteWebDav).toHaveBeenCalledOnce())
    expect(toast.success).toHaveBeenCalledWith('admin.settings.webdavVerified')
  })

  it('saves WebDAV enablement and a custom domain from the settings drawer', async () => {
    vi.mocked(updateSiteWebDav).mockResolvedValueOnce({
      ...state.settings.webdav,
      domain: 'webdisk.example.com',
      candidateUrl: 'https://webdisk.example.com/',
    })
    const view = renderSettingsPage()
    openSection(view, 'admin.settings.webdavTitle', 'admin.settings.webdavDetails')

    fireEvent.change(view.getByLabelText('admin.settings.webdavDomain'), {
      target: { value: 'WebDisk.Example.com' },
    })
    fireEvent.click(view.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(updateSiteWebDav).toHaveBeenCalledWith({ enabled: true, domain: 'webdisk.example.com' }))
  })
})
