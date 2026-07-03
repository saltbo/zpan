import type { AdminAuditEvent } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserQuotaById, listAdminAuditLogs, listUserEntitlements, revokeUserEntitlement } from '@/lib/api'
import { adminGetUser } from '@/lib/auth-client'
import { AdminUserDetailPage } from './$userId'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ userId: 'user-1' }),
  }),
  Link: ({ children }: { children: ReactNode }) => <a href="/admin/users">{children}</a>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const defaultValue = values?.defaultValue
      if (typeof defaultValue === 'string') return defaultValue
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

vi.mock('@/components/ProBadge', () => ({
  ProBadge: () => <span>Pro</span>,
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: () => <div>admin.audit.upgradeTitle</div>,
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({
    hasFeature: () => true,
    isLoading: false,
  }),
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

function renderAdminUserDetailPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AdminUserDetailPage />
    </QueryClientProvider>,
  )
}

function auditEvent(overrides: Partial<AdminAuditEvent>): AdminAuditEvent {
  return {
    id: 'audit-1',
    orgId: 'org-1',
    orgName: 'Personal Space',
    userId: 'user-1',
    action: 'upload',
    targetType: 'file',
    targetId: 'file-1',
    targetName: 'first-page.txt',
    metadata: null,
    createdAt: '2026-01-02T03:04:05.000Z',
    user: {
      id: 'user-1',
      name: 'Ava Admin',
      image: null,
    },
    ...overrides,
  }
}

function mockUserDetailDependencies() {
  vi.mocked(adminGetUser).mockResolvedValue({
    id: 'user-1',
    name: 'Ava Admin',
    email: 'ava@example.com',
    username: 'ava',
    image: null,
    role: 'member',
    banned: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
  })
  vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
  vi.mocked(listUserEntitlements).mockResolvedValue({ orgId: 'org-1', items: [] })
  vi.mocked(revokeUserEntitlement).mockResolvedValue(undefined)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminUserDetailPage activity', () => {
  it('filters the activity request by the route user id and shows the empty state', async () => {
    mockUserDetailDependencies()
    vi.mocked(listAdminAuditLogs).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    renderAdminUserDetailPage()

    expect(await screen.findByText('activity.empty')).toBeTruthy()
    expect(listAdminAuditLogs).toHaveBeenCalledWith(1, 20, { userId: 'user-1' })
  })

  it('loads page 2 with the same user id filter and renders the next activity event', async () => {
    mockUserDetailDependencies()
    vi.mocked(listAdminAuditLogs).mockImplementation((page = 1) =>
      Promise.resolve({
        items: [
          auditEvent({
            id: `audit-${page}`,
            targetId: `file-${page}`,
            targetName: page === 1 ? 'first-page.txt' : 'second-page.txt',
            createdAt: page === 1 ? '2026-01-02T03:04:05.000Z' : '2026-01-03T03:04:05.000Z',
          }),
        ],
        total: 2,
        page,
        pageSize: 20,
      }),
    )

    const user = userEvent.setup()
    renderAdminUserDetailPage()

    expect(await screen.findByText(/first-page\.txt/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'activity.loadMore' }))

    await waitFor(() => expect(listAdminAuditLogs).toHaveBeenCalledWith(2, 20, { userId: 'user-1' }))
    expect(await screen.findByText(/second-page\.txt/)).toBeTruthy()
  })
})
