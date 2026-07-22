import { DEFAULT_ORG_QUOTA, DEFAULT_ORG_TRAFFIC_QUOTA, SignupMode } from '@shared/constants'
import type { BindingState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseBindingRepo, SystemOptionsRepo } from '../ports'
import { AppError } from '../ports'
import { loadBindingState, resolveEffectiveSignupMode } from './licensing'
import {
  getSiteSettings,
  type SiteSettingsDeps,
  updateSiteCaptcha,
  updateSiteIdentity,
  updateSiteQuotas,
  updateSiteRegistration,
  verifySiteWebDav,
} from './settings'

vi.mock('./licensing', () => ({ loadBindingState: vi.fn(), resolveEffectiveSignupMode: vi.fn() }))

const COMMUNITY: BindingState = { bound: false }
const PRO: BindingState = { bound: true, active: true, edition: 'pro' }
function makeDeps(entries: Array<[string, string]> = []) {
  const values = new Map(entries)
  const set = vi.fn(async (key: string, value: string) => {
    values.set(key, value)
  })
  const setMany = vi.fn(async (rows: Array<{ key: string; value: string }>) => {
    for (const row of rows) values.set(row.key, row.value)
  })
  const systemOptions: SystemOptionsRepo = {
    get: async (key) => (values.has(key) ? { key, value: values.get(key)! } : null),
    getValue: async (key) => values.get(key) ?? null,
    getMany: async (keys) => keys.flatMap((key) => (values.has(key) ? [{ key, value: values.get(key)! }] : [])),
    listByPrefix: async (prefix) =>
      [...values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    set,
    setMany,
    delete: async (key) => {
      values.delete(key)
    },
  }
  const deps: SiteSettingsDeps = {
    systemOptions,
    licenseBinding: {} as LicenseBindingRepo,
  }
  return { deps, values, set, setMany }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadBindingState).mockResolvedValue(COMMUNITY)
  vi.mocked(resolveEffectiveSignupMode).mockImplementation(async (_deps, raw) =>
    raw === SignupMode.CLOSED ? SignupMode.CLOSED : SignupMode.INVITE_ONLY,
  )
})

describe('site settings usecase', () => {
  it('returns structured defaults and never returns a captcha secret', async () => {
    const settings = await getSiteSettings(makeDeps().deps, 'https://pan.example.com/api/site/settings')

    expect(settings).toEqual({
      identity: { name: 'ZPan', description: '', publicUrl: 'https://pan.example.com' },
      registration: { configuredMode: SignupMode.OPEN, effectiveMode: SignupMode.INVITE_ONLY },
      captcha: {
        enabled: false,
        provider: 'cloudflare-turnstile',
        siteKey: '',
        secretConfigured: false,
        minScore: null,
      },
      quotas: {
        defaultOrgBytes: DEFAULT_ORG_QUOTA,
        defaultTeamBytes: DEFAULT_ORG_QUOTA,
        defaultMonthlyTrafficBytes: DEFAULT_ORG_TRAFFIC_QUOTA,
      },
      webdav: {
        pathUrl: 'https://pan.example.com/dav/',
        candidateUrl: 'https://dav.pan.example.com/',
        status: 'unverified',
        lastVerifiedAt: null,
        error: null,
      },
    })
    expect(JSON.stringify(settings)).not.toContain('secretKey')
  })

  it('updates Public URL without requiring white-label and normalizes the trailing slash', async () => {
    const { deps, setMany } = makeDeps()
    const result = await updateSiteIdentity(deps, {
      name: 'ZPan',
      description: '',
      publicUrl: 'https://files.example.com/',
    })

    expect(result.publicUrl).toBe('https://files.example.com')
    expect(loadBindingState).not.toHaveBeenCalled()
    expect(setMany).toHaveBeenCalledWith(
      expect.arrayContaining([{ key: 'site_public_origin', value: 'https://files.example.com' }]),
    )
    expect(setMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        { key: 'webdav_verified_origin', value: '' },
        { key: 'webdav_verified_at', value: '' },
        { key: 'webdav_verification_error', value: '' },
      ]),
    )
  })

  it('requires white-label only when name or description changes', async () => {
    const { deps, setMany } = makeDeps()

    await expect(
      updateSiteIdentity(deps, { name: 'Custom', description: '', publicUrl: 'https://files.example.com' }),
    ).rejects.toMatchObject({ httpStatus: 402, meta: { reason: 'FEATURE_NOT_AVAILABLE' } })
    expect(setMany).not.toHaveBeenCalled()

    vi.mocked(loadBindingState).mockResolvedValue(PRO)
    await expect(
      updateSiteIdentity(deps, { name: 'Custom', description: '', publicUrl: 'https://files.example.com' }),
    ).resolves.toMatchObject({ name: 'Custom' })
  })

  it('preserves the configured signup mode while returning the effective mode', async () => {
    const { deps, set } = makeDeps()
    const result = await updateSiteRegistration(deps, { mode: SignupMode.CLOSED })

    expect(set).toHaveBeenCalledWith('auth_signup_mode', SignupMode.CLOSED)
    expect(result).toEqual({ configuredMode: SignupMode.CLOSED, effectiveMode: SignupMode.CLOSED })
  })

  it('gates open registration by entitlement', async () => {
    const { deps, set } = makeDeps()
    await expect(updateSiteRegistration(deps, { mode: SignupMode.OPEN })).rejects.toBeInstanceOf(AppError)
    expect(set).not.toHaveBeenCalled()

    vi.mocked(loadBindingState).mockResolvedValue(PRO)
    await expect(updateSiteRegistration(deps, { mode: SignupMode.OPEN })).resolves.toBeDefined()
  })

  it('preserves an existing captcha secret when omitted and exposes only its configured state', async () => {
    const { deps, values, setMany } = makeDeps([['captcha_secret_key', 'existing-secret']])
    const result = await updateSiteCaptcha(deps, {
      enabled: true,
      provider: 'hcaptcha',
      siteKey: 'site-key',
      minScore: 0.7,
    })

    expect(result).toEqual({
      enabled: true,
      provider: 'hcaptcha',
      siteKey: 'site-key',
      secretConfigured: true,
      minScore: 0.7,
    })
    expect(values.get('captcha_secret_key')).toBe('existing-secret')
    expect(setMany).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('existing-secret')
  })

  it('rejects enabling captcha without a complete configuration', async () => {
    const { deps, setMany } = makeDeps()
    await expect(
      updateSiteCaptcha(deps, {
        enabled: true,
        provider: 'hcaptcha',
        siteKey: '',
        secretKey: null,
        minScore: null,
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(setMany).not.toHaveBeenCalled()
  })

  it('writes quota settings as one group', async () => {
    const { deps, setMany } = makeDeps()
    const input = { defaultOrgBytes: 1024, defaultTeamBytes: 2048, defaultMonthlyTrafficBytes: 4096 }

    await expect(updateSiteQuotas(deps, input)).resolves.toEqual(input)
    expect(setMany).toHaveBeenCalledWith([
      { key: 'default_org_quota', value: '1024' },
      { key: 'default_team_quota', value: '2048' },
      { key: 'default_org_monthly_traffic_quota', value: '4096' },
    ])
  })

  it('verifies and records the derived WebDAV origin', async () => {
    const { deps, values } = makeDeps([['site_public_origin', 'https://files.example.com']])
    const fetcher = vi.fn(
      async () =>
        new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="ZPan WebDAV"' },
        }),
    ) as typeof fetch

    const result = await verifySiteWebDav(
      deps,
      'https://files.example.com/api/site/settings/webdav/verification',
      fetcher,
    )

    expect(fetcher).toHaveBeenCalledWith(
      'https://dav.files.example.com/',
      expect.objectContaining({ method: 'OPTIONS', redirect: 'manual' }),
    )
    expect(result).toMatchObject({
      candidateUrl: 'https://dav.files.example.com/',
      status: 'ready',
      error: null,
    })
    expect(result.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(values.get('webdav_verified_origin')).toBe('https://dav.files.example.com')
  })

  it('stores a failed verification and keeps the path URL available', async () => {
    const { deps, values } = makeDeps([['site_public_origin', 'https://files.example.com']])
    const fetcher = vi.fn(async () => new Response('Not Found', { status: 404 })) as typeof fetch

    const result = await verifySiteWebDav(
      deps,
      'https://files.example.com/api/site/settings/webdav/verification',
      fetcher,
    )

    expect(result).toEqual({
      pathUrl: 'https://files.example.com/dav/',
      candidateUrl: 'https://dav.files.example.com/',
      status: 'failed',
      lastVerifiedAt: null,
      error: 'WebDAV verification returned HTTP 404 without the expected authentication challenge.',
    })
    expect(values.get('webdav_verified_origin')).toBe('')
  })
})
