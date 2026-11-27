// Tests for src/components/UpgradeHint.tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en.json'
import { UpgradeHint } from './UpgradeHint'

const session = vi.hoisted(() => ({ role: 'admin' as string | undefined }))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const value = (en as Record<string, string>)[key] ?? key
      return value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
    },
  }),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: session.role ? { user: { role: session.role } } : null }),
}))

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

afterEach(() => {
  cleanup()
  session.role = 'admin'
})

describe('UpgradeHint', () => {
  it('renders headline "Unlock with ZPan Pro"', () => {
    const { getByText } = render(<UpgradeHint feature="white_label" />)
    expect(getByText('Unlock with ZPan Pro')).toBeTruthy()
  })

  it('renders CTA "Upgrade to Pro"', () => {
    const { getByText } = render(<UpgradeHint feature="teams_unlimited" />)
    expect(getByText('Upgrade to Pro')).toBeTruthy()
  })

  it('links an admin to /admin/licensing [spec: upgrade-hints/admin-links-licensing]', () => {
    const { getByRole } = render(<UpgradeHint feature="white_label" />)
    const link = getByRole('link')
    expect(link.getAttribute('href')).toBe('/admin/licensing')
  })

  it('mentions the feature in the description', () => {
    const { getByText } = render(<UpgradeHint feature="white_label" />)
    // the feature label comes from admin.upgrade.feature.white_label in en.json
    expect(getByText(/Custom Branding/i)).toBeTruthy()
  })

  it('uses a custom action label when provided', () => {
    const { getByText } = render(<UpgradeHint feature="audit_log" actionLabel="Open billing" />)
    expect(getByText('Open billing')).toBeTruthy()
  })
})

describe('UpgradeHint — non-admin [spec: upgrade-hints/member-asks-admin]', () => {
  it.each([['user'], [undefined]])('tells role %s to ask the site administrator, with no licensing link', (role) => {
    session.role = role
    const { getByText, queryByRole } = render(<UpgradeHint feature="teams_unlimited" />)
    expect(getByText('Ask your site administrator to upgrade to ZPan Pro.')).toBeTruthy()
    expect(getByText('Unlimited Teams is a ZPan Pro feature.')).toBeTruthy()
    expect(queryByRole('link')).toBeNull()
  })

  it('keeps caller copy but drops the action', () => {
    session.role = 'user'
    const { getByText, queryByText } = render(
      <UpgradeHint feature="media_library" title="Unlock media libraries" description="Custom" actionLabel="Open" />,
    )
    expect(getByText('Unlock media libraries')).toBeTruthy()
    expect(getByText('Custom')).toBeTruthy()
    expect(queryByText('Open')).toBeNull()
    expect(getByText('Ask your site administrator to upgrade to ZPan Pro.')).toBeTruthy()
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
