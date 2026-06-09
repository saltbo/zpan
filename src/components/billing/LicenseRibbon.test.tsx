// Tests for src/components/billing/LicenseRibbon.tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LicenseRibbon } from './LicenseRibbon'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      if (values) return `${key}:${Object.values(values).join(':')}`
      return key
    },
  }),
}))

const useEntitlementMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: useEntitlementMock,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntitlement(overrides: {
  bound?: boolean
  edition?: string | null
  cloudDashboardUrl?: string | null
  isLoading?: boolean
}) {
  return {
    bound: false,
    edition: null,
    cloudDashboardUrl: null,
    active: false,
    hasFeature: vi.fn().mockReturnValue(false),
    isLoading: false,
    isError: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(cleanup)

beforeEach(() => {
  useEntitlementMock.mockReset()
})

describe('LicenseRibbon — loading state', () => {
  it('renders nothing while the entitlement query is loading', () => {
    useEntitlementMock.mockReturnValue(makeEntitlement({ isLoading: true }))

    const { container } = render(<LicenseRibbon />)

    expect(container.firstChild).toBeNull()
  })
})

describe('LicenseRibbon — Community edition (unbound)', () => {
  beforeEach(() => {
    useEntitlementMock.mockReturnValue(makeEntitlement({ bound: false }))
  })

  it('renders the ribbon container with license-ribbon slot', () => {
    const { container } = render(<LicenseRibbon />)

    expect(container.querySelector('[data-slot="license-ribbon"]')).toBeTruthy()
  })

  it('displays the Community label key', () => {
    const { getByText } = render(<LicenseRibbon />)

    expect(getByText('admin.licenseRibbon.community')).toBeTruthy()
  })

  it('links to the GitHub repo', () => {
    const { getByRole } = render(<LicenseRibbon />)

    expect(getByRole('link').getAttribute('href')).toBe('https://github.com/saltbo/zpan')
  })

  it('opens link in a new tab with rel="noopener noreferrer"', () => {
    const { getByRole } = render(<LicenseRibbon />)
    const link = getByRole('link')

    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('has an accessible aria-label naming the edition', () => {
    const { getByRole } = render(<LicenseRibbon />)
    const link = getByRole('link')

    // t('admin.licenseRibbon.ariaLabel', { edition: 'admin.licenseRibbon.community' })
    // → 'admin.licenseRibbon.ariaLabel:admin.licenseRibbon.community'
    expect(link.getAttribute('aria-label')).toBe('admin.licenseRibbon.ariaLabel:admin.licenseRibbon.community')
  })

  it('applies gray color (#64748B)', () => {
    const { getByRole } = render(<LicenseRibbon />)
    const link = getByRole('link') as HTMLElement

    expect(link.style.backgroundColor).toBe('rgb(100, 116, 139)')
  })
})

describe('LicenseRibbon — Pro edition', () => {
  beforeEach(() => {
    useEntitlementMock.mockReturnValue(makeEntitlement({ bound: true, edition: 'pro' }))
  })

  it('displays the Pro label key', () => {
    const { getByText } = render(<LicenseRibbon />)

    expect(getByText('admin.licenseRibbon.pro')).toBeTruthy()
  })

  it('links to the GitHub repo', () => {
    const { getByRole } = render(<LicenseRibbon />)

    expect(getByRole('link').getAttribute('href')).toBe('https://github.com/saltbo/zpan')
  })

  it('applies brand blue color (#1A73E8)', () => {
    const { getByRole } = render(<LicenseRibbon />)
    const link = getByRole('link') as HTMLElement

    expect(link.style.backgroundColor).toBe('rgb(26, 115, 232)')
  })
})

describe('LicenseRibbon — Business edition', () => {
  it('displays the Business label key', () => {
    useEntitlementMock.mockReturnValue(makeEntitlement({ bound: true, edition: 'business' }))

    const { getByText } = render(<LicenseRibbon />)

    expect(getByText('admin.licenseRibbon.business')).toBeTruthy()
  })

  it('links to cloud_dashboard_url when provided', () => {
    useEntitlementMock.mockReturnValue(
      makeEntitlement({ bound: true, edition: 'business', cloudDashboardUrl: 'https://cloud.example.com/dash' }),
    )

    const { getByRole } = render(<LicenseRibbon />)

    expect(getByRole('link').getAttribute('href')).toBe('https://cloud.example.com/dash')
  })

  it('falls back to the default cloud dashboard URL when cloud_dashboard_url is absent', () => {
    useEntitlementMock.mockReturnValue(makeEntitlement({ bound: true, edition: 'business', cloudDashboardUrl: null }))

    const { getByRole } = render(<LicenseRibbon />)

    expect(getByRole('link').getAttribute('href')).toBe('https://cloud.zpan.space/dashboard')
  })

  it('applies gold color (#F59E0B)', () => {
    useEntitlementMock.mockReturnValue(makeEntitlement({ bound: true, edition: 'business' }))

    const { getByRole } = render(<LicenseRibbon />)
    const link = getByRole('link') as HTMLElement

    expect(link.style.backgroundColor).toBe('rgb(245, 158, 11)')
  })
})

describe('LicenseRibbon — bound but unknown edition falls back to Pro', () => {
  it('uses Pro styles when edition is not "business"', () => {
    useEntitlementMock.mockReturnValue(makeEntitlement({ bound: true, edition: null }))

    const { getByText } = render(<LicenseRibbon />)

    expect(getByText('admin.licenseRibbon.pro')).toBeTruthy()
  })
})
