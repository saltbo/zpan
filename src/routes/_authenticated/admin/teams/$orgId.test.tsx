import type { AdminAuditEvent, OrgQuotaEntitlement } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getTeam, listAdminAuditLogs, listOrgEntitlements, revokeOrgEntitlement, type TeamSummary } from '@/lib/api'
import { Route } from './$orgId'

const routeParams = vi.hoisted(() => ({ orgId: 'route-org-1' }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    ...options,
    useParams: () => routeParams,
  }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'activity.title') return 'Activity'
      if (key === 'activity.empty') return 'No activity yet'
      if (key === 'activity.loadError') return 'Failed to load activity'
      if (key === 'activity.loadMore') return 'Load more'
      if (key === 'admin.teams.tabEntitlement') return 'Entitlement'
      if (key === 'admin.teams.entitlements') return 'Quota entitlements'
      if (key === 'admin.teams.addEntitlement') return 'Grant quota'
      if (key === 'admin.teams.revokeEntitlement') return 'Revoke'
      if (key === 'admin.teams.revokeEntitlementTitle') return 'Revoke entitlement'
      if (key === 'admin.teams.revokeEntitlementConfirm') return `Revoke this quota entitlement from ${values?.name}?`
      if (key === 'admin.teams.entitlementRevoked') return 'Entitlement revoked'
      if (key === 'admin.teams.noEntitlements') return 'No entitlements yet.'
      if (key === 'admin.teams.entitlementType') return 'Type'
      if (key === 'admin.teams.entitlementAmount') return 'Amount'
      if (key === 'admin.teams.entitlementSource') return 'Source'
      if (key === 'admin.teams.entitlementExpires') return 'Expires'
      if (key === 'admin.teams.entitlementStatus') return 'Status'
      if (key === 'admin.teams.entitlementActions') return 'Actions'
      if (key === 'admin.teams.entitlementTypeGrant') return 'Grant'
      if (key === 'admin.teams.entitlementSourceAdmin') return 'Admin grant'
      if (key === 'admin.teams.noExpiry') return 'No expiry'
      if (key === 'admin.teams.active') return 'Active'
      if (key === 'admin.teams.teamDetails') return 'Team details'
      if (key === 'admin.teams.memberCount') return `${values?.count} members`
      if (key === 'admin.teams.colOwner') return 'Owner'
      if (key === 'admin.teams.colUsage') return 'Storage'
      if (key === 'admin.teams.activeEntitlements') return 'Active grants'
      if (key === 'admin.teams.backToTeams') return 'Back to teams'
      if (key === 'admin.users.prevPage') return 'Previous'
      if (key === 'admin.users.nextPage') return 'Next'
      if (key === 'admin.users.pageInfo') return `Page ${values?.page} of ${values?.total}`
      if (key === 'admin.users.pageSize') return 'Rows per page'
      if (key === 'admin.users.pageSizeOption') return `${values?.count} / page`
      if (key === 'admin.audit.eventType') return 'Event type'
      if (key === 'admin.audit.timeRange') return 'Time range'
      if (key === 'admin.audit.allEvents') return 'All events'
      if (key === 'admin.audit.allTime') return 'All time'
      if (key === 'admin.audit.last7Days') return 'Last 7 days'
      if (key === 'admin.audit.upgradeTitle') return 'Unlock Audit Logs'
      if (key === 'admin.audit.upgradeDescription') return 'Audit Logs are a Pro feature.'
      if (key === 'admin.audit.upgradeButton') return 'Upgrade to Pro'
      if (key === 'activity.action.upload') return 'uploaded'
      if (key === 'activity.action.rename') return 'renamed'
      if (key === 'activity.target.file') return 'file'
      if (!values) return key
      return Object.entries(values).reduce(
        (message, [name, value]) => message.replace(`{{${name}}}`, String(value)),
        key,
      )
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/components/admin/grant-entitlement-dialog', () => ({
  GrantEntitlementDialog: () => null,
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: ({
    feature,
    title,
    description,
    actionLabel,
  }: {
    feature: string
    title?: string
    description?: string
    actionLabel?: string
  }) => (
    <div data-testid="upgrade-hint">
      <span>{feature}</span>
      {title && <span>{title}</span>}
      {description && <span>{description}</span>}
      {actionLabel && <span>{actionLabel}</span>}
    </div>
  ),
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  getTeam: vi.fn(),
  listAdminAuditLogs: vi.fn(),
  listOrgEntitlements: vi.fn(),
  revokeOrgEntitlement: vi.fn(),
}))

type TeamDetailRoute = typeof Route & {
  component: React.ComponentType
}

function renderTeamDetailPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  const Component = (Route as TeamDetailRoute).component

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Component />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

function team(overrides: Partial<TeamSummary> = {}): TeamSummary {
  return {
    id: 'route-org-1',
    name: 'Acme Team',
    slug: 'acme',
    logo: null,
    memberCount: 3,
    ownerName: 'Ava Stone',
    quotaUsed: 0,
    quotaTotal: 1024,
    createdAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
    ...overrides,
  }
}

function auditEvent(overrides: Partial<AdminAuditEvent> = {}): AdminAuditEvent {
  return {
    id: 'audit-1',
    orgId: 'route-org-1',
    orgName: 'Acme Team',
    userId: 'user-1',
    actorType: 'user',
    actorRef: null,
    action: 'upload',
    targetType: 'file',
    targetId: 'file-1',
    targetName: 'contract.pdf',
    metadata: null,
    createdAt: '2026-02-01T10:00:00.000Z',
    user: {
      id: 'user-1',
      name: 'Ava Stone',
      image: null,
    },
    ...overrides,
  }
}

function entitlement(overrides: Partial<OrgQuotaEntitlement> = {}): OrgQuotaEntitlement {
  return {
    id: 'entitlement-1',
    orgId: 'route-org-1',
    resourceType: 'storage',
    entitlementType: 'grant',
    source: 'admin_grant',
    sourceId: 'admin-grant-1',
    bytes: 1024,
    startsAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    status: 'active',
    metadata: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function auditPage(page: number, items: AdminAuditEvent[], total = items.length, pageSize = 20) {
  return {
    items,
    total,
    page,
    pageSize,
  }
}

function allowAuditLogs() {
  vi.mocked(useEntitlement).mockReturnValue({
    bound: true,
    active: true,
    edition: 'pro',
    licenseId: 'license-1',
    cloudDashboardUrl: null,
    hasFeature: (feature) => feature === 'audit_log',
    isLoading: false,
    isError: false,
  })
}

function blockAuditLogs() {
  vi.mocked(useEntitlement).mockReturnValue({
    bound: false,
    active: false,
    edition: null,
    licenseId: null,
    cloudDashboardUrl: null,
    hasFeature: () => false,
    isLoading: false,
    isError: false,
  })
}

function mockBaseQueries(entitlements: OrgQuotaEntitlement[] = []) {
  vi.mocked(getTeam).mockResolvedValue(team())
  vi.mocked(listOrgEntitlements).mockResolvedValue({ orgId: 'route-org-1', items: entitlements })
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  routeParams.orgId = 'route-org-1'
})

describe('Admin team detail activity', () => {
  it('calls listAdminAuditLogs with the route org id filter', async () => {
    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs).mockResolvedValue(auditPage(1, [auditEvent()]))

    renderTeamDetailPage()

    expect(await screen.findByText(/contract\.pdf/)).toBeTruthy()
    expect(listAdminAuditLogs).toHaveBeenCalledWith(1, 20, { orgId: 'route-org-1' })
  })

  it('renders Activity and Entitlement tabs in order and pages activity results', async () => {
    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs)
      .mockResolvedValueOnce(auditPage(1, [auditEvent()], 21))
      .mockResolvedValueOnce(auditPage(2, [auditEvent({ id: 'audit-2', targetName: 'page-two.pdf' })], 21))

    const user = userEvent.setup()
    renderTeamDetailPage()

    expect(await screen.findByText(/contract\.pdf/)).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Activity', 'Entitlement'])
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/page-two\.pdf/)).toBeTruthy()
    await waitFor(() => expect(listAdminAuditLogs).toHaveBeenCalledWith(2, 20, { orgId: 'route-org-1' }))
  })

  it('filters activity by event type and time range while preserving the route org id and resetting pagination', async () => {
    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs).mockResolvedValue(auditPage(1, [auditEvent()], 21))

    const user = userEvent.setup()
    renderTeamDetailPage()

    expect(await screen.findByText(/contract\.pdf/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(listAdminAuditLogs).toHaveBeenCalledWith(2, 20, { orgId: 'route-org-1' }))

    await user.click(screen.getByRole('combobox', { name: 'Event type' }))
    await user.click(await screen.findByRole('option', { name: 'renamed' }))

    await waitFor(() =>
      expect(listAdminAuditLogs).toHaveBeenCalledWith(1, 20, {
        orgId: 'route-org-1',
        action: 'rename',
      }),
    )

    await user.click(screen.getByRole('combobox', { name: 'Time range' }))
    await user.click(await screen.findByRole('option', { name: 'Last 7 days' }))

    await waitFor(() =>
      expect(listAdminAuditLogs).toHaveBeenCalledWith(
        1,
        20,
        expect.objectContaining({
          orgId: 'route-org-1',
          action: 'rename',
          createdFrom: expect.any(String),
          createdTo: expect.any(String),
        }),
      ),
    )
  })

  it('renders activity empty and error states', async () => {
    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs).mockResolvedValueOnce(auditPage(1, []))

    const emptyView = renderTeamDetailPage()
    expect(await screen.findByText('No activity yet')).toBeTruthy()
    expect(screen.getByText('Page 1 of 1')).toBeTruthy()
    emptyView.unmount()
    cleanup()

    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs).mockRejectedValueOnce(new Error('boom'))

    renderTeamDetailPage()
    expect(await screen.findByText('Failed to load activity')).toBeTruthy()
    expect(screen.queryByText('Page 1 of 1')).toBeNull()
  })

  it('renders the activity loading state', async () => {
    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs).mockReturnValue(new Promise(() => {}))

    renderTeamDetailPage()

    expect(await screen.findByText('Acme Team')).toBeTruthy()
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('does not call listAdminAuditLogs and renders the no-feature upgrade UI when audit_log is unavailable', async () => {
    blockAuditLogs()
    mockBaseQueries()

    renderTeamDetailPage()

    expect(await screen.findByText('Acme Team')).toBeTruthy()
    expect(screen.getByTestId('upgrade-hint').textContent).toContain('audit_log')
    expect(screen.getByTestId('upgrade-hint').textContent).toContain('Unlock Audit Logs')
    expect(listAdminAuditLogs).not.toHaveBeenCalled()
  })

  it('keeps entitlement revoke working and refetches team activity after revoke', async () => {
    allowAuditLogs()
    mockBaseQueries([entitlement()])
    let revoked = false
    vi.mocked(revokeOrgEntitlement).mockImplementation(async () => {
      revoked = true
    })
    vi.mocked(listAdminAuditLogs).mockImplementation(() =>
      Promise.resolve(
        auditPage(1, [
          revoked
            ? auditEvent({ id: 'audit-after-revoke', targetName: 'after-revoke.pdf' })
            : auditEvent({ targetName: 'before-revoke.pdf' }),
        ]),
      ),
    )

    const user = userEvent.setup()
    renderTeamDetailPage()

    expect(await screen.findByText(/before-revoke\.pdf/)).toBeTruthy()
    const initialActivityCalls = vi.mocked(listAdminAuditLogs).mock.calls.length
    await user.click(screen.getByRole('tab', { name: 'Entitlement' }))
    expect(screen.getByText('Quota entitlements')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(revokeOrgEntitlement).toHaveBeenCalledWith('route-org-1', 'entitlement-1'))
    await waitFor(() => {
      const postRevokeActivityCalls = vi.mocked(listAdminAuditLogs).mock.calls.slice(initialActivityCalls)
      expect(postRevokeActivityCalls).toContainEqual([1, 20, { orgId: 'route-org-1' }])
    })
    await user.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(await screen.findByText(/after-revoke\.pdf/)).toBeTruthy()
  })
})
