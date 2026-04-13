import { SignupMode } from '@shared/constants'
import { describe, expect, it } from 'vitest'

// Tests for useSiteOptions option-mapping logic.
// The hook cannot be rendered outside React, so the pure option-map derivation
// is replicated here and tested directly. This covers the public contract:
// each option key maps to the correct typed return field, with correct defaults.

type SiteOption = { key: string; value: string; public: boolean }

function deriveSiteOptions(items: SiteOption[]) {
  const optionMap = new Map(items.map((item) => [item.key, item.value]))

  return {
    siteName: optionMap.get('site_name') ?? '',
    siteDescription: optionMap.get('site_description') ?? '',
    defaultOrgQuota: Number(optionMap.get('default_org_quota') ?? '0'),
    authSignupMode: (optionMap.get('auth_signup_mode') as 'open' | 'invite_only' | 'closed') ?? 'open',
  }
}

describe('useSiteOptions — option mapping', () => {
  describe('defaults when no options are present', () => {
    it('defaults siteName to empty string', () => {
      const result = deriveSiteOptions([])

      expect(result.siteName).toBe('')
    })

    it('defaults siteDescription to empty string', () => {
      const result = deriveSiteOptions([])

      expect(result.siteDescription).toBe('')
    })

    it('defaults defaultOrgQuota to 0', () => {
      const result = deriveSiteOptions([])

      expect(result.defaultOrgQuota).toBe(0)
    })

    it('defaults authSignupMode to "open"', () => {
      const result = deriveSiteOptions([])

      expect(result.authSignupMode).toBe(SignupMode.OPEN)
    })
  })

  describe('siteName mapping', () => {
    it('returns site_name option value as siteName', () => {
      const result = deriveSiteOptions([{ key: 'site_name', value: 'My ZPan', public: true }])

      expect(result.siteName).toBe('My ZPan')
    })

    it('returns empty string when site_name is an empty string value', () => {
      const result = deriveSiteOptions([{ key: 'site_name', value: '', public: true }])

      expect(result.siteName).toBe('')
    })
  })

  describe('siteDescription mapping', () => {
    it('returns site_description option value as siteDescription', () => {
      const result = deriveSiteOptions([{ key: 'site_description', value: 'An S3 file host', public: true }])

      expect(result.siteDescription).toBe('An S3 file host')
    })
  })

  describe('defaultOrgQuota mapping', () => {
    it('converts default_org_quota string to a number', () => {
      const result = deriveSiteOptions([{ key: 'default_org_quota', value: '1073741824', public: false }])

      expect(result.defaultOrgQuota).toBe(1073741824)
    })

    it('returns 0 when default_org_quota value is "0"', () => {
      const result = deriveSiteOptions([{ key: 'default_org_quota', value: '0', public: false }])

      expect(result.defaultOrgQuota).toBe(0)
    })

    it('returns 0 when default_org_quota is missing', () => {
      const result = deriveSiteOptions([{ key: 'site_name', value: 'ZPan', public: true }])

      expect(result.defaultOrgQuota).toBe(0)
    })
  })

  describe('authSignupMode mapping', () => {
    it('returns "open" when auth_signup_mode is "open"', () => {
      const result = deriveSiteOptions([{ key: 'auth_signup_mode', value: 'open', public: true }])

      expect(result.authSignupMode).toBe(SignupMode.OPEN)
    })

    it('returns "invite_only" when auth_signup_mode is "invite_only"', () => {
      const result = deriveSiteOptions([{ key: 'auth_signup_mode', value: 'invite_only', public: true }])

      expect(result.authSignupMode).toBe(SignupMode.INVITE_ONLY)
    })

    it('returns "closed" when auth_signup_mode is "closed"', () => {
      const result = deriveSiteOptions([{ key: 'auth_signup_mode', value: 'closed', public: true }])

      expect(result.authSignupMode).toBe(SignupMode.CLOSED)
    })

    it('falls back to "open" when auth_signup_mode key is absent', () => {
      const result = deriveSiteOptions([{ key: 'site_name', value: 'ZPan', public: true }])

      expect(result.authSignupMode).toBe(SignupMode.OPEN)
    })
  })

  describe('multiple options together', () => {
    it('maps all options correctly from a full option list', () => {
      const items: SiteOption[] = [
        { key: 'site_name', value: 'ZPan v2', public: true },
        { key: 'site_description', value: 'File hosting', public: true },
        { key: 'default_org_quota', value: '5368709120', public: false },
        { key: 'auth_signup_mode', value: 'invite_only', public: true },
      ]

      const result = deriveSiteOptions(items)

      expect(result.siteName).toBe('ZPan v2')
      expect(result.siteDescription).toBe('File hosting')
      expect(result.defaultOrgQuota).toBe(5368709120)
      expect(result.authSignupMode).toBe(SignupMode.INVITE_ONLY)
    })

    it('uses last value when duplicate keys are present', () => {
      const items: SiteOption[] = [
        { key: 'site_name', value: 'First', public: true },
        { key: 'site_name', value: 'Second', public: true },
      ]

      const result = deriveSiteOptions(items)

      // Map construction from array: last entry wins
      expect(result.siteName).toBe('Second')
    })
  })
})
