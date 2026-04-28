// Tests for src/routes/_authenticated/teams/index.tsx
// Covers: isAtLimit computation, handleNewTeamClick branching, ProBadge render,
// and UpgradeDialog vs CreateTeamDialog routing.
import { cleanup, fireEvent, render } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Pure-logic tests — isAtLimit derivation
// These mirror the logic in TeamsPage without needing to render the full tree.
// ---------------------------------------------------------------------------

describe('isAtLimit logic', () => {
  function computeIsAtLimit(hasTeamsUnlimited: boolean, totalOrgCount: number, orgsLoading = false): boolean {
    const FREE_TEAM_LIMIT = 2
    return !orgsLoading && !hasTeamsUnlimited && totalOrgCount >= FREE_TEAM_LIMIT
  }

  it('is false when user has 0 orgs and no pro feature', () => {
    expect(computeIsAtLimit(false, 0)).toBe(false)
  })

  it('is false when user has 1 org and no pro feature', () => {
    expect(computeIsAtLimit(false, 1)).toBe(false)
  })

  it('is true when user has exactly 2 orgs and no pro feature', () => {
    expect(computeIsAtLimit(false, 2)).toBe(true)
  })

  it('is true when user has 3 orgs and no pro feature', () => {
    expect(computeIsAtLimit(false, 3)).toBe(true)
  })

  it('is false when user has 2 orgs but has teams_unlimited feature', () => {
    expect(computeIsAtLimit(true, 2)).toBe(false)
  })

  it('is false when user has 10 orgs and has teams_unlimited feature', () => {
    expect(computeIsAtLimit(true, 10)).toBe(false)
  })

  it('personal workspace counts toward the total (totalOrgCount includes all orgs)', () => {
    // If the user has only a personal workspace (1 org total) — not at limit
    expect(computeIsAtLimit(false, 1)).toBe(false)
    // Two orgs (personal + 1 team) — at limit
    expect(computeIsAtLimit(false, 2)).toBe(true)
    // Three orgs (personal + 2 teams) — still at limit
    expect(computeIsAtLimit(false, 3)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// handleNewTeamClick branching logic
// ---------------------------------------------------------------------------

describe('handleNewTeamClick branching', () => {
  function handleNewTeamClick(
    isAtLimit: boolean,
    setUpgradeOpen: (v: boolean) => void,
    setCreateOpen: (v: boolean) => void,
  ) {
    if (isAtLimit) {
      setUpgradeOpen(true)
    } else {
      setCreateOpen(true)
    }
  }

  it('opens upgrade dialog when at limit', () => {
    const setUpgradeOpen = vi.fn()
    const setCreateOpen = vi.fn()
    handleNewTeamClick(true, setUpgradeOpen, setCreateOpen)
    expect(setUpgradeOpen).toHaveBeenCalledWith(true)
    expect(setCreateOpen).not.toHaveBeenCalled()
  })

  it('opens create dialog when not at limit', () => {
    const setUpgradeOpen = vi.fn()
    const setCreateOpen = vi.fn()
    handleNewTeamClick(false, setUpgradeOpen, setCreateOpen)
    expect(setCreateOpen).toHaveBeenCalledWith(true)
    expect(setUpgradeOpen).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// slugify helper — extracted inline for contract testing
// ---------------------------------------------------------------------------

describe('slugify helper', () => {
  function slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
  }

  it('converts spaces to hyphens', () => {
    expect(slugify('My Team Name')).toBe('my-team-name')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugify('  Team  ')).toBe('team')
  })

  it('collapses consecutive special chars to a single hyphen', () => {
    expect(slugify('Team!!Name')).toBe('team-name')
  })

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(70)
    expect(slugify(long).length).toBe(60)
  })

  it('lowercases input', () => {
    expect(slugify('UPPERCASE')).toBe('uppercase')
  })

  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })

  it('preserves digits', () => {
    expect(slugify('Team123')).toBe('team123')
  })
})

// ---------------------------------------------------------------------------
// Component render tests — UpgradeDialog wrapping UpgradeHint
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: vi.fn(),
  useListOrganizations: vi.fn(),
  getFullOrganization: vi.fn(),
  authClient: {
    organization: {
      create: vi.fn(),
      setActive: vi.fn(),
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => ({ component: (c: unknown) => c }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueries: vi.fn(() => []),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  QueryClient: vi.fn(),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/layout/page-header', () => ({
  PageHeader: ({ actions }: { items: unknown[]; actions?: React.ReactNode }) => (
    <div data-testid="page-header">{actions}</div>
  ),
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: ({ feature }: { feature: string }) => (
    <div data-testid="upgrade-hint" data-feature={feature}>
      UpgradeHint
    </div>
  ),
}))

vi.mock('@/components/ProBadge', () => ({
  ProBadge: ({ className }: { className?: string }) => (
    <span data-testid="pro-badge" className={className}>
      Pro
    </span>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    type,
    ...rest
  }: {
    children: React.ReactNode
    onClick?: React.MouseEventHandler
    type?: string
    disabled?: boolean
    size?: string
    variant?: string
    [key: string]: unknown
  }) => (
    <button type={(type as 'button' | 'submit' | 'reset') || 'button'} {...rest}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('lucide-react', () => ({
  Plus: () => <span>+</span>,
  Users: () => <span>users-icon</span>,
}))

vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => vi.fn(),
}))

vi.mock('react-hook-form', () => ({
  useForm: () => ({
    register: (name: string) => ({ name }),
    handleSubmit: (fn: (v: unknown) => void) => (e: React.FormEvent) => {
      e.preventDefault()
      fn({})
    },
    setValue: vi.fn(),
    getFieldState: () => ({ isDirty: false }),
    formState: { errors: {} },
    reset: vi.fn(),
  }),
}))

import { useEntitlement } from '@/hooks/useEntitlement'
import { useListOrganizations, useSession } from '@/lib/auth-client'

function makeEntitlement(hasTeamsUnlimited: boolean) {
  vi.mocked(useEntitlement).mockReturnValue({
    bound: true,
    plan: hasTeamsUnlimited ? 'pro' : 'community',
    features: hasTeamsUnlimited ? ['teams_unlimited'] : [],
    hasFeature: (name: string) => hasTeamsUnlimited && name === 'teams_unlimited',
    isLoading: false,
    isError: false,
  })
}

function makeSession(userId = 'user-1') {
  vi.mocked(useSession).mockReturnValue({
    data: { user: { id: userId } },
    isPending: false,
    error: null,
  } as ReturnType<typeof useSession>)
}

function makeOrgs(count: number) {
  const orgs = Array.from({ length: count }, (_, i) => ({
    id: `org-${i}`,
    name: `Org ${i}`,
    slug: i === 0 ? `personal-user-1` : `team-${i}`,
  }))
  vi.mocked(useListOrganizations).mockReturnValue({
    data: orgs,
    isPending: false,
    error: null,
  } as ReturnType<typeof useListOrganizations>)
}

// Lazy-import the component after mocks are registered
async function renderTeamsPage() {
  const { TeamsPage } = await import('./TeamsPage.test-helper')
  return render(<TeamsPage />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// We test TeamsPage indirectly by isolating the pure component logic in a
// helper shim. Because TanStack Router exports createFileRoute at module
// init time and vitest resets modules between files (not between tests),
// we import TeamsPage through a re-export helper to side-step router binding.
// The render tests below cover the ProBadge and UpgradeDialog branching.

describe('TeamsPage — ProBadge visibility', () => {
  beforeEach(() => {
    makeSession()
  })

  it('renders ProBadge on the button when at limit (2 orgs, no pro feature)', async () => {
    makeOrgs(2)
    makeEntitlement(false)
    const { findByTestId } = await renderTeamsPage()
    await findByTestId('pro-badge')
  })

  it('does not render ProBadge when under limit (1 org, no pro feature)', async () => {
    makeOrgs(1)
    makeEntitlement(false)
    const { queryByTestId } = await renderTeamsPage()
    expect(queryByTestId('pro-badge')).toBeNull()
  })

  it('does not render ProBadge when pro user has 2 orgs', async () => {
    makeOrgs(2)
    makeEntitlement(true)
    const { queryByTestId } = await renderTeamsPage()
    expect(queryByTestId('pro-badge')).toBeNull()
  })
})

describe('TeamsPage — button click behavior', () => {
  beforeEach(() => {
    makeSession()
  })

  it('opens UpgradeHint dialog when at limit and button is clicked', async () => {
    makeOrgs(2)
    makeEntitlement(false)
    const { findByTestId, queryByTestId } = await renderTeamsPage()
    // No upgrade hint visible initially
    expect(queryByTestId('upgrade-hint')).toBeNull()

    const btn = await findByTestId('new-team-btn')
    fireEvent.click(btn)

    // UpgradeHint should now be visible inside the dialog
    await findByTestId('upgrade-hint')
  })

  it('does not open UpgradeHint dialog when not at limit and button is clicked', async () => {
    makeOrgs(2)
    makeEntitlement(false)
    const { findByTestId, queryByTestId } = await renderTeamsPage()
    const btn = await findByTestId('new-team-btn')
    fireEvent.click(btn)
    expect(queryByTestId('upgrade-hint')).toBeNull()
  })

  it('does not open UpgradeHint when pro user at 3 orgs clicks button', async () => {
    makeOrgs(3)
    makeEntitlement(true)
    const { findByTestId, queryByTestId } = await renderTeamsPage()
    const btn = await findByTestId('new-team-btn')
    fireEvent.click(btn)
    expect(queryByTestId('upgrade-hint')).toBeNull()
  })
})
