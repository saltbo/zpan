// Tests for src/components/UpgradeHint.tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpgradeHint } from './UpgradeHint'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/button', () => ({
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

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(cleanup)

describe('UpgradeHint', () => {
  it('renders headline "Unlock with ZPan Pro"', () => {
    const { getByText } = render(<UpgradeHint feature="white_label" />)
    expect(getByText('Unlock with ZPan Pro')).toBeTruthy()
  })

  it('renders CTA "Upgrade to Pro"', () => {
    const { getByText } = render(<UpgradeHint feature="teams_unlimited" />)
    expect(getByText('Upgrade to Pro')).toBeTruthy()
  })

  it('links CTA to /admin/licensing', () => {
    const { getByRole } = render(<UpgradeHint feature="white_label" />)
    const link = getByRole('link')
    expect(link.getAttribute('href')).toBe('/admin/licensing')
  })

  it('mentions the feature in the description', () => {
    const { getByText } = render(<UpgradeHint feature="white_label" />)
    expect(getByText(/white-label/i)).toBeTruthy()
  })

  it('uses a custom action label when provided', () => {
    const { getByText } = render(<UpgradeHint feature="audit_log" actionLabel="Open billing" />)
    expect(getByText('Open billing')).toBeTruthy()
  })
})

describe('UpgradeHint — data-slot', () => {
  it('renders with upgrade-hint slot attribute', () => {
    const { container } = render(<UpgradeHint feature="open_registration" />)
    const el = container.querySelector('[data-slot="upgrade-hint"]')
    expect(el).toBeTruthy()
  })

  it('renders the shared pro-upgrade-prompt slot', () => {
    const { container } = render(<UpgradeHint feature="open_registration" />)
    const el = container.querySelector('[data-slot="pro-upgrade-prompt"]')
    expect(el).toBeTruthy()
  })
})
