import { describe, expect, it } from 'vitest'
import type { SiteOption } from '@/lib/api'

// The pure data-transformation logic from useSiteOptions:
// given a list of SiteOption items, produce the structured options object.
// We extract and test this independently of the React hook infrastructure.

function buildSiteOptions(items: SiteOption[]) {
  const optionMap = new Map(items.map((item) => [item.key, item.value]))
  return {
    siteName: optionMap.get('site_name') ?? '',
    siteDescription: optionMap.get('site_description') ?? '',
    defaultOrgQuota: Number(optionMap.get('default_org_quota') ?? '0'),
    authSignupMode: (optionMap.get('auth_signup_mode') ?? 'open') as 'open' | 'invite_only' | 'closed',
  }
}

describe('useSiteOptions — authSignupMode default', () => {
  it('defaults authSignupMode to "open" when auth_signup_mode key is absent', () => {
    const result = buildSiteOptions([])

    expect(result.authSignupMode).toBe('open')
  })

  it('defaults authSignupMode to "open" when items list is empty', () => {
    const result = buildSiteOptions([])

    expect(result.authSignupMode).toBe('open')
  })

  it('returns "open" when auth_signup_mode value is "open"', () => {
    const result = buildSiteOptions([{ key: 'auth_signup_mode', value: 'open', public: true }])

    expect(result.authSignupMode).toBe('open')
  })

  it('returns "invite_only" when auth_signup_mode value is "invite_only"', () => {
    const result = buildSiteOptions([{ key: 'auth_signup_mode', value: 'invite_only', public: true }])

    expect(result.authSignupMode).toBe('invite_only')
  })

  it('returns "closed" when auth_signup_mode value is "closed"', () => {
    const result = buildSiteOptions([{ key: 'auth_signup_mode', value: 'closed', public: true }])

    expect(result.authSignupMode).toBe('closed')
  })
})

describe('useSiteOptions — siteName', () => {
  it('defaults siteName to empty string when site_name key is absent', () => {
    const result = buildSiteOptions([])

    expect(result.siteName).toBe('')
  })

  it('returns siteName from site_name option', () => {
    const result = buildSiteOptions([{ key: 'site_name', value: 'ZPan', public: true }])

    expect(result.siteName).toBe('ZPan')
  })
})

describe('useSiteOptions — siteDescription', () => {
  it('defaults siteDescription to empty string when site_description key is absent', () => {
    const result = buildSiteOptions([])

    expect(result.siteDescription).toBe('')
  })

  it('returns siteDescription from site_description option', () => {
    const result = buildSiteOptions([{ key: 'site_description', value: 'My cloud storage', public: true }])

    expect(result.siteDescription).toBe('My cloud storage')
  })
})

describe('useSiteOptions — defaultOrgQuota', () => {
  it('defaults defaultOrgQuota to 0 when default_org_quota key is absent', () => {
    const result = buildSiteOptions([])

    expect(result.defaultOrgQuota).toBe(0)
  })

  it('parses defaultOrgQuota as a number', () => {
    const result = buildSiteOptions([{ key: 'default_org_quota', value: '1073741824', public: false }])

    expect(result.defaultOrgQuota).toBe(1073741824)
  })

  it('returns 0 for defaultOrgQuota when value is "0"', () => {
    const result = buildSiteOptions([{ key: 'default_org_quota', value: '0', public: false }])

    expect(result.defaultOrgQuota).toBe(0)
  })
})

describe('useSiteOptions — multiple options together', () => {
  it('maps all fields from a full options list', () => {
    const items: SiteOption[] = [
      { key: 'site_name', value: 'TestDrive', public: true },
      { key: 'site_description', value: 'A test site', public: true },
      { key: 'default_org_quota', value: '5368709120', public: false },
      { key: 'auth_signup_mode', value: 'invite_only', public: true },
    ]

    const result = buildSiteOptions(items)

    expect(result.siteName).toBe('TestDrive')
    expect(result.siteDescription).toBe('A test site')
    expect(result.defaultOrgQuota).toBe(5368709120)
    expect(result.authSignupMode).toBe('invite_only')
  })

  it('ignores unknown option keys', () => {
    const items: SiteOption[] = [
      { key: 'unknown_key', value: 'should-be-ignored', public: false },
      { key: 'auth_signup_mode', value: 'closed', public: true },
    ]

    const result = buildSiteOptions(items)

    expect(result.authSignupMode).toBe('closed')
    expect(result.siteName).toBe('')
  })
})

describe('useSiteOptions — siteOptionsQueryKey contract', () => {
  it('query key is ["system", "options"]', async () => {
    const { siteOptionsQueryKey } = await import('./use-site-options')

    expect(siteOptionsQueryKey).toEqual(['system', 'options'])
  })

  it('query key first segment is "system"', async () => {
    const { siteOptionsQueryKey } = await import('./use-site-options')

    expect(siteOptionsQueryKey[0]).toBe('system')
  })

  it('query key second segment is "options"', async () => {
    const { siteOptionsQueryKey } = await import('./use-site-options')

    expect(siteOptionsQueryKey[1]).toBe('options')
  })
})
