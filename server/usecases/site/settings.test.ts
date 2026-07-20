import { DEFAULT_ORG_QUOTA, DEFAULT_ORG_TRAFFIC_QUOTA, SignupMode } from '@shared/constants'
import type { BindingState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRepo, LicenseBindingRepo, SystemOptionsRepo } from '../ports'
import { AppError } from '../ports'
import { loadBindingState, resolveEffectiveSignupMode } from './licensing'
import {
  getSiteSettings,
  type SiteSettingsDeps,
  updateSiteCaptcha,
  updateSiteIdentity,
  updateSiteQuotas,
  updateSiteRegistration,
} from './settings'

vi.mock('./licensing', () => ({ loadBindingState: vi.fn(), resolveEffectiveSignupMode: vi.fn() }))

const COMMUNITY: BindingState = { bound: false }
const PRO: BindingState = { bound: true, active: true, edition: 'pro' }
const actor = { userId: 'user-1', orgId: 'org-1' }

function makeDeps(entries: Array<[string, string]> = []) {
  const values = new Map(entries)
  const set = vi.fn(async (key: string, value: string) => {
    values.set(key, value)
  })
  const setMany = vi.fn(async (rows: Array<{ key: string; value: string }>) => {
    for (const row of rows) values.set(row.key, row.value)
  })
  const record = vi.fn(async () => {})
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
    activity: { record } as unknown as ActivityRepo,
  }
  return { deps, values, set, setMany, record }
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
    })
    expect(JSON.stringify(settings)).not.toContain('secretKey')
  })

  it('updates Public URL without requiring white-label and normalizes the trailing slash', async () => {
    const { deps, setMany, record } = makeDeps()
    const result = await updateSiteIdentity(deps, actor, {
      name: 'ZPan',
      description: '',
      publicUrl: 'https://files.example.com/',
    })

    expect(result.publicUrl).toBe('https://files.example.com')
    expect(loadBindingState).not.toHaveBeenCalled()
    expect(setMany).toHaveBeenCalledWith(
      expect.arrayContaining([{ key: 'site_public_origin', value: 'https://files.example.com' }]),
    )
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'site_identity_update' }))
  })

  it('requires white-label only when name or description changes', async () => {
    const { deps, setMany } = makeDeps()

    await expect(
      updateSiteIdentity(deps, actor, { name: 'Custom', description: '', publicUrl: 'https://files.example.com' }),
    ).rejects.toMatchObject({ httpStatus: 402, meta: { reason: 'FEATURE_NOT_AVAILABLE' } })
    expect(setMany).not.toHaveBeenCalled()

    vi.mocked(loadBindingState).mockResolvedValue(PRO)
    await expect(
      updateSiteIdentity(deps, actor, { name: 'Custom', description: '', publicUrl: 'https://files.example.com' }),
    ).resolves.toMatchObject({ name: 'Custom' })
  })

  it('preserves the configured signup mode while returning the effective mode', async () => {
    const { deps, set } = makeDeps()
    const result = await updateSiteRegistration(deps, actor, { mode: SignupMode.CLOSED })

    expect(set).toHaveBeenCalledWith('auth_signup_mode', SignupMode.CLOSED)
    expect(result).toEqual({ configuredMode: SignupMode.CLOSED, effectiveMode: SignupMode.CLOSED })
  })

  it('gates open registration by entitlement', async () => {
    const { deps, set } = makeDeps()
    await expect(updateSiteRegistration(deps, actor, { mode: SignupMode.OPEN })).rejects.toBeInstanceOf(AppError)
    expect(set).not.toHaveBeenCalled()

    vi.mocked(loadBindingState).mockResolvedValue(PRO)
    await expect(updateSiteRegistration(deps, actor, { mode: SignupMode.OPEN })).resolves.toBeDefined()
  })

  it('preserves an existing captcha secret when omitted and exposes only its configured state', async () => {
    const { deps, values, setMany } = makeDeps([['captcha_secret_key', 'existing-secret']])
    const result = await updateSiteCaptcha(deps, actor, {
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
      updateSiteCaptcha(deps, actor, {
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

    await expect(updateSiteQuotas(deps, actor, input)).resolves.toEqual(input)
    expect(setMany).toHaveBeenCalledWith([
      { key: 'default_org_quota', value: '1024' },
      { key: 'default_team_quota', value: '2048' },
      { key: 'default_org_monthly_traffic_quota', value: '4096' },
    ])
  })
})
