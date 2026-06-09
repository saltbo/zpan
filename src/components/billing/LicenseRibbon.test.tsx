// Tests for LicenseRibbon pure logic.
// No jsdom/testing-library available — test resolveRibbon directly.
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Mirror of the resolveRibbon helper from LicenseRibbon.tsx
// ---------------------------------------------------------------------------

const GITHUB_URL = 'https://github.com/saltbo/zpan'
const CLOUD_DASHBOARD_FALLBACK = 'https://cloud.zpan.space/dashboard'

interface RibbonConfig {
  labelKey: string
  color: string
  href: string
}

function resolveRibbon(bound: boolean, edition: string | null, cloudDashboardUrl: string | undefined): RibbonConfig {
  if (!bound || !edition) {
    return {
      labelKey: 'admin.ribbon.community',
      color: '#64748B',
      href: GITHUB_URL,
    }
  }
  if (edition === 'business') {
    return {
      labelKey: 'admin.ribbon.business',
      color: '#F59E0B',
      href: cloudDashboardUrl ?? CLOUD_DASHBOARD_FALLBACK,
    }
  }
  return {
    labelKey: 'admin.ribbon.pro',
    color: '#1A73E8',
    href: GITHUB_URL,
  }
}

// ---------------------------------------------------------------------------
// Community (unbound or edition unknown)
// ---------------------------------------------------------------------------

describe('resolveRibbon — Community', () => {
  it('uses community label key when unbound', () => {
    const result = resolveRibbon(false, null, undefined)
    expect(result.labelKey).toBe('admin.ribbon.community')
  })

  it('uses gray color when unbound', () => {
    const result = resolveRibbon(false, null, undefined)
    expect(result.color).toBe('#64748B')
  })

  it('links to GitHub when unbound', () => {
    const result = resolveRibbon(false, null, undefined)
    expect(result.href).toBe(GITHUB_URL)
  })

  it('ignores edition value when not bound', () => {
    const result = resolveRibbon(false, 'pro', undefined)
    expect(result.labelKey).toBe('admin.ribbon.community')
  })

  it('falls back to community when bound but edition is null (transient state)', () => {
    // When the server returns bound=true but no edition yet (e.g., refresh in progress
    // or license error), the ribbon shows Community to avoid incorrectly advertising Pro.
    const result = resolveRibbon(true, null, undefined)
    expect(result.labelKey).toBe('admin.ribbon.community')
  })
})

// ---------------------------------------------------------------------------
// Pro (bound, edition === 'pro')
// ---------------------------------------------------------------------------

describe('resolveRibbon — Pro', () => {
  it('uses pro label key for pro edition', () => {
    const result = resolveRibbon(true, 'pro', undefined)
    expect(result.labelKey).toBe('admin.ribbon.pro')
  })

  it('uses brand blue for pro', () => {
    const result = resolveRibbon(true, 'pro', undefined)
    expect(result.color).toBe('#1A73E8')
  })

  it('links to GitHub for pro (per product spec)', () => {
    const result = resolveRibbon(true, 'pro', undefined)
    expect(result.href).toBe(GITHUB_URL)
  })
})

// ---------------------------------------------------------------------------
// Business (bound, edition === 'business')
// ---------------------------------------------------------------------------

describe('resolveRibbon — Business', () => {
  it('uses business label key for business edition', () => {
    const result = resolveRibbon(true, 'business', undefined)
    expect(result.labelKey).toBe('admin.ribbon.business')
  })

  it('uses gold color for business', () => {
    const result = resolveRibbon(true, 'business', undefined)
    expect(result.color).toBe('#F59E0B')
  })

  it('uses cloud_dashboard_url when provided', () => {
    const url = 'https://cloud.zpan.space/dashboard/org/123'
    const result = resolveRibbon(true, 'business', url)
    expect(result.href).toBe(url)
  })

  it('falls back to default cloud dashboard URL when cloud_dashboard_url is absent', () => {
    const result = resolveRibbon(true, 'business', undefined)
    expect(result.href).toBe(CLOUD_DASHBOARD_FALLBACK)
  })
})
