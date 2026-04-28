// Tests for src/components/UpgradeHint.tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpgradeHint } from './UpgradeHint'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: vi.fn(),
}))

vi.mock('./ui/button', () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: {
    children: React.ReactNode
    asChild?: boolean
    [key: string]: unknown
  }) =>
    asChild ? (
      children
    ) : (
      <button type="button" {...props}>
        {children}
      </button>
    ),
}))

vi.mock('./ui/card', () => ({
  Card: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { useEntitlement } from '@/hooks/useEntitlement'

function setupEntitlement(bound: boolean) {
  vi.mocked(useEntitlement).mockReturnValue({
    bound,
    plan: bound ? 'community' : null,
    features: [],
    hasFeature: () => false,
    isLoading: false,
    isError: false,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(cleanup)

describe('UpgradeHint — unbound state', () => {
  beforeEach(() => setupEntitlement(false))

  it('renders headline "Unlock with ZPan Pro"', () => {
    const { getByText } = render(<UpgradeHint feature="white_label" />)
    expect(getByText('Unlock with ZPan Pro')).toBeTruthy()
  })

  it('renders CTA "Connect to Cloud" when not bound', () => {
    const { getByText } = render(<UpgradeHint feature="teams_unlimited" />)
    expect(getByText('Connect to Cloud')).toBeTruthy()
  })

  it('links CTA to /admin/billing', () => {
    const { getByRole } = render(<UpgradeHint feature="white_label" />)
    const link = getByRole('link')
    expect(link.getAttribute('href')).toBe('/admin/billing')
  })

  it('mentions the feature in the description', () => {
    const { getByText } = render(<UpgradeHint feature="white_label" />)
    expect(getByText(/white-label/i)).toBeTruthy()
  })
})

describe('UpgradeHint — bound state', () => {
  beforeEach(() => setupEntitlement(true))

  it('renders CTA "Manage on Cloud" when bound', () => {
    const { getByText } = render(<UpgradeHint feature="storages_unlimited" />)
    expect(getByText('Manage on Cloud')).toBeTruthy()
  })

  it('does not render "Connect to Cloud" when bound', () => {
    const { queryByText } = render(<UpgradeHint feature="storages_unlimited" />)
    expect(queryByText('Connect to Cloud')).toBeNull()
  })
})

describe('UpgradeHint — data-slot', () => {
  beforeEach(() => setupEntitlement(false))

  it('renders with upgrade-hint slot attribute', () => {
    const { container } = render(<UpgradeHint feature="open_registration" />)
    const el = container.querySelector('[data-slot="upgrade-hint"]')
    expect(el).toBeTruthy()
  })
})
