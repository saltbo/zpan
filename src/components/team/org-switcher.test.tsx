import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrgSwitcher } from './org-switcher'

const mocks = vi.hoisted(() => ({
  activeOrg: {
    id: 'personal-org',
    name: 'Personal Space',
    slug: 'u1234567890abcdef',
    metadata: { type: 'personal' },
  },
  createOpen: vi.fn(),
  hasFeature: vi.fn(() => false),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  orgs: [
    {
      id: 'personal-org',
      name: 'Personal Space',
      slug: 'u1234567890abcdef',
      metadata: { type: 'personal' },
    },
    {
      id: 'team-org',
      name: 'Design Team',
      slug: 't1234567890abcdef',
      metadata: { type: 'team' },
    },
  ],
  pathname: '/files',
  setActive: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: ReactNode; to: string; params?: { teamId?: string } }) => (
    <a href={params?.teamId ? to.replace('$teamId', params.teamId) : to}>{children}</a>
  ),
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: mocks.pathname } }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({ hasFeature: mocks.hasFeature }),
}))

vi.mock('@/lib/auth-client', () => ({
  setActive: mocks.setActive,
  useActiveOrganization: () => ({ data: mocks.activeOrg }),
  useListOrganizations: () => ({ data: mocks.orgs, isPending: false }),
}))

vi.mock('@/components/team/create-team-dialog', () => ({
  CreateTeamDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="create-team-dialog">create</div> : null),
  TeamLimitDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="team-limit-dialog">upgrade</div> : null),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({
    children,
    asChild: _asChild,
    isActive: _isActive,
    ...props
  }: {
    children: ReactNode
    asChild?: boolean
    isActive?: boolean
    [key: string]: unknown
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  mocks.pathname = '/files'
  mocks.hasFeature.mockReturnValue(false)
  mocks.setActive.mockResolvedValue({ data: null, error: null })
  mocks.invalidateQueries.mockResolvedValue(undefined)
})

async function openSwitcher() {
  const view = render(<OrgSwitcher />)
  fireEvent.pointerDown(view.getByRole('button', { name: /Personal Space/ }), { button: 0, ctrlKey: false })
  await view.findByRole('menu')
  return view
}

describe('OrgSwitcher', () => {
  it('renders workspaces as one continuous group and separates only the actions', async () => {
    const view = await openSwitcher()

    expect(view.getByRole('menuitem', { name: /Personal Space/ })).toBeTruthy()
    expect(view.getByRole('menuitem', { name: /Design Team/ })).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="dropdown-menu-separator"]')).toHaveLength(1)
  })

  it('switches workspace and returns to the files home', async () => {
    const view = await openSwitcher()

    fireEvent.click(view.getByRole('menuitem', { name: /Design Team/ }))

    await waitFor(() => expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: 'team-org' }))
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['objects'] })
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/files' })
  })

  it('links workspace settings to the active workspace', async () => {
    const view = await openSwitcher()

    expect(view.getByRole('link', { name: 'org.workspaceSettings' }).getAttribute('href')).toBe(
      '/teams/personal-org/settings',
    )
  })

  it('opens the first workspace settings tab when switching workspaces from settings', async () => {
    mocks.pathname = '/teams/personal-org/billing'
    const view = await openSwitcher()

    fireEvent.click(view.getByRole('menuitem', { name: /Design Team/ }))

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/teams/$teamId/settings',
        params: { teamId: 'team-org' },
      }),
    )
  })

  it('opens the upgrade dialog when the workspace limit is reached', async () => {
    const view = await openSwitcher()

    fireEvent.click(view.getByRole('menuitem', { name: /teams.createNew/ }))

    expect(view.getByTestId('team-limit-dialog')).toBeTruthy()
    expect(view.queryByTestId('create-team-dialog')).toBeNull()
  })

  it('opens the create dialog for an entitled account', async () => {
    mocks.hasFeature.mockReturnValue(true)
    const view = await openSwitcher()

    fireEvent.click(view.getByRole('menuitem', { name: /teams.createNew/ }))

    expect(view.getByTestId('create-team-dialog')).toBeTruthy()
    expect(view.queryByTestId('team-limit-dialog')).toBeNull()
  })
})
