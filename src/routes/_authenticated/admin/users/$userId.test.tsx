import type { AdminAuditEvent, OrgQuotaEntitlement } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getUserQuotaById, listAdminAuditLogs, listUserEntitlements, revokeUserEntitlement } from '@/lib/api'
import { type AdminUser, adminGetUser } from '@/lib/auth-client'
import { Route } from './$userId'

const routeParams = vi.hoisted(() => ({ userId: 'route-user-1' }))

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
      if (key === 'activity.loadMore') return 'Load more'
      if (key === 'admin.users.tabEntitlement') return 'Entitlement'
      if (key === 'admin.users.prevPage') return 'Previous'
      if (key === 'admin.users.nextPage') return 'Next'
      if (key === 'admin.users.pageInfo') return `Page ${values?.page} of ${values?.total}`
      if (key === 'admin.users.pageSize') return 'Rows per page'
      if (key === 'admin.users.pageSizeOption') return `${values?.count} / page`
      if (key === 'admin.audit.eventType') return 'Event type'
      if (key === 'admin.audit.timeRange') return 'Time range'
      if (key === 'admin.audit.allEvents') return 'All events'
      if (key === 'admin.audit.allTime') return 'All time'
      if (key === 'admin.audit.last24Hours') return 'Last 24 hours'
      if (key === 'admin.audit.last7Days') return 'Last 7 days'
      if (key === 'admin.audit.last30Days') return 'Last 30 days'
      if (key === 'admin.audit.last90Days') return 'Last 90 days'
      if (key === 'admin.audit.upgradeTitle') return 'Unlock Audit Logs'
      if (key === 'admin.audit.upgradeDescription') {
        return 'Audit Logs are a Pro feature. Upgrade to gain full visibility into instance-wide activity.'
      }
      if (key === 'admin.audit.upgradeButton') return 'Upgrade to Pro'
      if (key === 'activity.action.upload') return 'uploaded'
      if (key === 'activity.action.object_copy') return 'copied'
      if (key === 'activity.action.rename') return 'renamed'
      if (key === 'activity.action.delete') return 'deleted'
      if (key === 'activity.target.file') return 'file'
      if (key === 'activity.meta.from') return 'from'
      if (key === 'activity.meta.to') return 'to'
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
  getUserQuotaById: vi.fn(),
  listAdminAuditLogs: vi.fn(),
  listUserEntitlements: vi.fn(),
  revokeUserEntitlement: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  adminGetUser: vi.fn(),
}))

type UserDetailRoute = typeof Route & {
  component: React.ComponentType
}

function renderUserDetailPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  const Component = (Route as UserDetailRoute).component

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Component />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'route-user-1',
    name: 'Ava Stone',
    email: 'ava@example.com',
    username: 'ava',
    image: null,
    role: 'member',
    banned: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
    ...overrides,
  }
}

function auditEvent(overrides: Partial<AdminAuditEvent> = {}): AdminAuditEvent {
  return {
    id: 'audit-1',
    orgId: 'org-1',
    orgName: 'Personal',
    userId: 'route-user-1',
    actorType: 'user',
    actorRef: null,
    action: 'upload',
    targetType: 'file',
    targetId: 'file-1',
    targetName: 'contract.pdf',
    metadata: null,
    createdAt: '2026-02-01T10:00:00.000Z',
    user: {
      id: 'route-user-1',
      name: 'Ava Stone',
      image: null,
    },
    ...overrides,
  }
}

function entitlement(overrides: Partial<OrgQuotaEntitlement> = {}): OrgQuotaEntitlement {
  return {
    id: 'entitlement-1',
    orgId: 'org-1',
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

function auditPage(page: number, items: AdminAuditEvent[], total = items.length) {
  return {
    items,
    total,
    page,
    pageSize: 20,
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
  vi.mocked(adminGetUser).mockResolvedValue(user())
  vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
  vi.mocked(listUserEntitlements).mockResolvedValue({ orgId: 'org-1', items: entitlements })
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
  routeParams.userId = 'route-user-1'
})

describe('Admin user detail activity', () => {
  it('calls listAdminAuditLogs with the route user id filter', async () => {
    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs).mockResolvedValue(auditPage(1, [auditEvent()]))

    renderUserDetailPage()

    expect(await screen.findByText(/contract\.pdf/)).toBeTruthy()
    expect(listAdminAuditLogs).toHaveBeenCalledWith(1, 20, { userId: 'route-user-1' })
  })

  it('renders the activity empty state', async () => {
    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs).mockResolvedValue(auditPage(1, []))

    renderUserDetailPage()

    expect(await screen.findByRole('tab', { name: 'Activity' })).toBeTruthy()
    expect(await screen.findByText('No activity yet')).toBeTruthy()
  })

  it('renders Activity and Entitlement tabs in order and pages activity results', async () => {
    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs)
      .mockResolvedValueOnce(auditPage(1, [auditEvent()], 21))
      .mockResolvedValueOnce(
        auditPage(
          2,
          [
            auditEvent({
              id: 'audit-2',
              action: 'rename',
              targetName: 'renamed-contract.pdf',
              metadata: JSON.stringify({ from: 'contract.pdf' }),
            }),
          ],
          21,
        ),
      )

    renderUserDetailPage()

    expect(await screen.findByText(/contract\.pdf/)).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Activity', 'Entitlement'])
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/renamed-contract\.pdf/)).toBeTruthy()
    await waitFor(() => expect(listAdminAuditLogs).toHaveBeenCalledWith(2, 20, { userId: 'route-user-1' }))
  })

  it('filters activity by event type and time range while preserving the route user id', async () => {
    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs).mockResolvedValue(auditPage(1, [auditEvent()]))

    const user = userEvent.setup()
    renderUserDetailPage()

    expect(await screen.findByText(/contract\.pdf/)).toBeTruthy()
    await user.click(screen.getByRole('combobox', { name: 'Event type' }))
    await user.click(await screen.findByRole('option', { name: 'copied' }))

    await waitFor(() =>
      expect(listAdminAuditLogs).toHaveBeenCalledWith(1, 20, {
        userId: 'route-user-1',
        action: 'object_copy',
      }),
    )

    await user.click(screen.getByRole('combobox', { name: 'Time range' }))
    await user.click(await screen.findByRole('option', { name: 'Last 7 days' }))

    await waitFor(() =>
      expect(listAdminAuditLogs).toHaveBeenCalledWith(
        1,
        20,
        expect.objectContaining({
          userId: 'route-user-1',
          action: 'object_copy',
          createdFrom: expect.any(String),
          createdTo: expect.any(String),
        }),
      ),
    )
  })

  it('renders status/result and all useful activity metadata fields', async () => {
    allowAuditLogs()
    mockBaseQueries()
    vi.mocked(listAdminAuditLogs).mockResolvedValue(
      auditPage(1, [
        auditEvent({
          id: 'audit-metadata-status',
          targetName: 'metadata-status.pdf',
          metadata: JSON.stringify({
            status: 'completed',
            from: 'old-name.pdf',
            to: 'metadata-status.pdf',
            actor: 'admin@example.com',
            reason: 'manual grant',
            source: 'admin console',
            requestId: 'req-123',
            ip: '203.0.113.9',
            bytes: 2048,
            nested: { plan: 'pro' },
            empty: '',
          }),
        }),
        auditEvent({
          id: 'audit-metadata-result',
          targetName: 'metadata-result.pdf',
          metadata: JSON.stringify({
            result: 'failed',
            cause: 'license expired',
          }),
        }),
      ]),
    )

    renderUserDetailPage()

    expect(await screen.findByText('completed')).toBeTruthy()
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('from: old-name.pdf')).toBeTruthy()
    expect(screen.getByText('to: metadata-status.pdf')).toBeTruthy()
    expect(screen.getByText('actor: admin@example.com')).toBeTruthy()
    expect(screen.getByText('reason: manual grant')).toBeTruthy()
    expect(screen.getByText('source: admin console')).toBeTruthy()
    expect(screen.getByText('requestId: req-123')).toBeTruthy()
    expect(screen.getByText('ip: 203.0.113.9')).toBeTruthy()
    expect(screen.getByText('bytes: 2048')).toBeTruthy()
    expect(screen.getByText('nested: {"plan":"pro"}')).toBeTruthy()
    expect(screen.queryByText('empty:')).toBeNull()
  })

  it('refetches user activity after revoking an entitlement', async () => {
    allowAuditLogs()
    mockBaseQueries([entitlement()])
    let revoked = false
    vi.mocked(revokeUserEntitlement).mockImplementation(async () => {
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
    renderUserDetailPage()

    expect(await screen.findByText(/before-revoke\.pdf/)).toBeTruthy()
    const initialActivityCalls = vi.mocked(listAdminAuditLogs).mock.calls.length
    await user.click(screen.getByRole('tab', { name: 'Entitlement' }))
    await user.click(screen.getByRole('button', { name: 'admin.users.revokeEntitlement' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'admin.users.revokeEntitlement' }))

    await waitFor(() => expect(revokeUserEntitlement).toHaveBeenCalledWith('route-user-1', 'entitlement-1'))
    await waitFor(() => {
      const postRevokeActivityCalls = vi.mocked(listAdminAuditLogs).mock.calls.slice(initialActivityCalls)
      expect(postRevokeActivityCalls).toContainEqual([1, 20, { userId: 'route-user-1' }])
    })
    await user.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(await screen.findByText(/after-revoke\.pdf/)).toBeTruthy()
  })

  it('does not call listAdminAuditLogs and renders the no-feature upgrade UI when audit_log is unavailable', async () => {
    blockAuditLogs()
    mockBaseQueries()

    renderUserDetailPage()

    expect(await screen.findByText('Ava Stone')).toBeTruthy()
    expect(screen.getByTestId('upgrade-hint').textContent).toContain('audit_log')
    expect(screen.getByTestId('upgrade-hint').textContent).toContain('Unlock Audit Logs')
    expect(listAdminAuditLogs).not.toHaveBeenCalled()
  })
})
