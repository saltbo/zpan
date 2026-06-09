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

// TanStack Router's <Link> needs a router context; render a plain anchor instead.
vi.mock('@tanstack/react-router', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
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

describe('LicenseRibbon — Free edition (unbound)', () => {
  beforeEach(() => {
    useEntitlementMock.mockReturnValue(makeEntitlement({ bound: false }))
  })

  it('renders the ribbon container with license-ribbon slot', () => {
    const { container } = render(<LicenseRibbon />)

    expect(container.querySelector('[data-slot="license-ribbon"]')).toBeTruthy()
  })

  it('displays the Free (community) label key', () => {
    const { getByText } = render(<LicenseRibbon />)

    expect(getByText('admin.licenseRibbon.community')).toBeTruthy()
  })

  it('links to the About page', () => {
    const { getByRole } = render(<LicenseRibbon />)

    expect(getByRole('link').getAttribute('href')).toBe('/admin/about')
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

  it('links to the About page', () => {
    const { getByRole } = render(<LicenseRibbon />)

    expect(getByRole('link').getAttribute('href')).toBe('/admin/about')
  })

  it('applies gold color (#D8AB44)', () => {
    const { getByRole } = render(<LicenseRibbon />)
    const link = getByRole('link') as HTMLElement

    expect(link.style.backgroundColor).toBe('rgb(216, 171, 68)')
  })
})

describe('LicenseRibbon — Business edition', () => {
  beforeEach(() => {
    useEntitlementMock.mockReturnValue(makeEntitlement({ bound: true, edition: 'business' }))
  })

  it('displays the Business label key', () => {
    const { getByText } = render(<LicenseRibbon />)

    expect(getByText('admin.licenseRibbon.business')).toBeTruthy()
  })

  it('links to the About page', () => {
    const { getByRole } = render(<LicenseRibbon />)

    expect(getByRole('link').getAttribute('href')).toBe('/admin/about')
  })

  it('applies indigo color (#5B73E8)', () => {
    const { getByRole } = render(<LicenseRibbon />)
    const link = getByRole('link') as HTMLElement

    expect(link.style.backgroundColor).toBe('rgb(91, 115, 232)')
  })
})

describe('LicenseRibbon — bound but unknown edition falls back to Pro', () => {
  it('uses Pro styles when edition is not "business"', () => {
    useEntitlementMock.mockReturnValue(makeEntitlement({ bound: true, edition: null }))

    const { getByText } = render(<LicenseRibbon />)

    expect(getByText('admin.licenseRibbon.pro')).toBeTruthy()
  })
})
