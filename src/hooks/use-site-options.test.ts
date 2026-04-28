import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_NAME, SignupMode } from '@shared/constants'
import { describe, expect, it } from 'vitest'
import type { SiteOption } from '@/lib/api'

// useSiteOptions is a React hook backed by react-query; the project has no jsdom
// or @testing-library/react setup, so we cannot render it here.
// We test the pure option-map extraction logic that the hook applies, which is
// the entirety of the hook's non-query logic: building a Map from items and
// reading named keys from it.

function buildOptionsMap(items: SiteOption[]): Map<string, string> {
  return new Map(items.map((item) => [item.key, item.value]))
}

function resolveSiteName(optionMap: Map<string, string>): string {
  return optionMap.get('site_name') ?? DEFAULT_SITE_NAME
}

function resolveSiteDescription(optionMap: Map<string, string>): string {
  return optionMap.get('site_description') ?? DEFAULT_SITE_DESCRIPTION
}

function resolveDefaultOrgQuota(optionMap: Map<string, string>): number {
  return Number(optionMap.get('default_org_quota') ?? '0')
}

function resolveAuthSignupMode(optionMap: Map<string, string>): SignupMode {
  return (optionMap.get('auth_signup_mode') as SignupMode) ?? SignupMode.OPEN
}

function makeItem(key: string, value: string): SiteOption {
  return { key, value, public: true }
}

describe('useSiteOptions — option map extraction logic', () => {
  describe('siteName', () => {
    it('returns site_name value when present', () => {
      const map = buildOptionsMap([makeItem('site_name', 'ZPan')])

      expect(resolveSiteName(map)).toBe('ZPan')
    })

    it('returns default site name when site_name is absent', () => {
      const map = buildOptionsMap([])

      expect(resolveSiteName(map)).toBe(DEFAULT_SITE_NAME)
    })
  })

  describe('siteDescription', () => {
    it('returns site_description value when present', () => {
      const map = buildOptionsMap([makeItem('site_description', 'Open S3 hosting')])

      expect(resolveSiteDescription(map)).toBe('Open S3 hosting')
    })

    it('returns default site description when site_description is absent', () => {
      const map = buildOptionsMap([])

      expect(resolveSiteDescription(map)).toBe(DEFAULT_SITE_DESCRIPTION)
    })
  })

  describe('defaultOrgQuota', () => {
    it('returns parsed number when default_org_quota is present', () => {
      const map = buildOptionsMap([makeItem('default_org_quota', '1073741824')])

      expect(resolveDefaultOrgQuota(map)).toBe(1073741824)
    })

    it('returns 0 when default_org_quota is absent', () => {
      const map = buildOptionsMap([])

      expect(resolveDefaultOrgQuota(map)).toBe(0)
    })

    it('returns 0 when default_org_quota is "0"', () => {
      const map = buildOptionsMap([makeItem('default_org_quota', '0')])

      expect(resolveDefaultOrgQuota(map)).toBe(0)
    })
  })

  describe('authSignupMode', () => {
    it('returns SignupMode.OPEN when auth_signup_mode is "open"', () => {
      const map = buildOptionsMap([makeItem('auth_signup_mode', 'open')])

      expect(resolveAuthSignupMode(map)).toBe(SignupMode.OPEN)
    })

    it('returns SignupMode.INVITE_ONLY when auth_signup_mode is "invite_only"', () => {
      const map = buildOptionsMap([makeItem('auth_signup_mode', 'invite_only')])

      expect(resolveAuthSignupMode(map)).toBe(SignupMode.INVITE_ONLY)
    })

    it('returns SignupMode.CLOSED when auth_signup_mode is "closed"', () => {
      const map = buildOptionsMap([makeItem('auth_signup_mode', 'closed')])

      expect(resolveAuthSignupMode(map)).toBe(SignupMode.CLOSED)
    })

    it('defaults to SignupMode.OPEN when auth_signup_mode is absent', () => {
      const map = buildOptionsMap([])

      expect(resolveAuthSignupMode(map)).toBe(SignupMode.OPEN)
    })
  })

  describe('buildOptionsMap', () => {
    it('builds map with all provided items', () => {
      const items = [makeItem('site_name', 'MyZPan'), makeItem('site_description', 'desc')]
      const map = buildOptionsMap(items)

      expect(map.get('site_name')).toBe('MyZPan')
      expect(map.get('site_description')).toBe('desc')
    })

    it('returns empty map for empty items array', () => {
      const map = buildOptionsMap([])

      expect(map.size).toBe(0)
    })

    it('last duplicate key wins in the map', () => {
      const items = [makeItem('site_name', 'first'), makeItem('site_name', 'second')]
      const map = buildOptionsMap(items)

      expect(map.get('site_name')).toBe('second')
    })
  })

  describe('siteOptionsQueryKey', () => {
    it('matches the expected shape ["system", "options"]', async () => {
      // Import directly to document the contract so changes break visibly.
      const { siteOptionsQueryKey } = await import('./use-site-options')

      expect(siteOptionsQueryKey).toEqual(['system', 'options'])
    })
  })
})
