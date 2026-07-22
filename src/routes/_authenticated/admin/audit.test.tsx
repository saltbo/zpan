import type { AdminAuditEvent } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEntitlement } from '@/hooks/useEntitlement'
import { listAdminAuditLogs } from '@/lib/api'
import { Route } from './audit'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => options,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'admin.audit.title') return 'Audit Logs'
      if (key === 'admin.audit.description') return 'Track activity'
      if (key === 'admin.audit.eventType') return 'Event type'
      if (key === 'admin.audit.timeRange') return 'Time range'
      if (key === 'admin.audit.allEvents') return 'All events'
      if (key === 'admin.audit.allTime') return 'All time'
      if (key === 'admin.audit.last24Hours') return 'Last 24 hours'
      if (key === 'admin.audit.last7Days') return 'Last 7 days'
      if (key === 'admin.audit.last30Days') return 'Last 30 days'
      if (key === 'admin.audit.last90Days') return 'Last 90 days'
      if (key === 'admin.audit.empty') return 'No audit events yet.'
      if (key === 'admin.users.prevPage') return 'Previous'
      if (key === 'admin.users.nextPage') return 'Next'
      if (key === 'admin.users.pageInfo') return `Page ${values?.page} of ${values?.total}`
      if (key === 'admin.users.pageSize') return 'Rows per page'
      if (key === 'admin.users.pageSizeOption') return `${values?.count} / page`
      if (key === 'activity.action.upload') return 'uploaded'
      if (key === 'activity.action.delete') return 'deleted'
      if (key === 'activity.action.replace') return 'replaced'
      if (key === 'activity.action.share_download') return 'downloaded via share'
      if (key === 'activity.target.file') return 'file'
      return key
    },
  }),
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  listAdminAuditLogs: vi.fn(),
}))

type AuditRoute = typeof Route & {
  component: React.ComponentType
}

function renderAuditPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  const Component = (Route as AuditRoute).component

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Component />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

function auditEvent(overrides: Partial<AdminAuditEvent> = {}): AdminAuditEvent {
  return {
    id: 'audit-1',
    orgId: 'org-1',
    orgName: 'Personal',
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

function auditPage(page: number, items: AdminAuditEvent[], total = items.length, pageSize = 20) {
  return {
    items,
    total,
    page,
    pageSize,
  }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
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
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AuditLogsPage filters and pagination', () => {
  it('uses structured filters and standard pagination', async () => {
    vi.mocked(listAdminAuditLogs).mockResolvedValue(auditPage(1, [auditEvent()], 21))

    const user = userEvent.setup()
    renderAuditPage()

    expect(await screen.findByText(/contract\.pdf/)).toBeTruthy()
    expect(listAdminAuditLogs).toHaveBeenCalledWith(1, 20, {})
    expect(screen.queryByRole('button', { name: 'admin.audit.loadMore' })).toBeNull()

    await user.click(screen.getByRole('combobox', { name: 'Event type' }))
    await user.click(await screen.findByRole('option', { name: 'downloaded via share' }))

    await waitFor(() => expect(listAdminAuditLogs).toHaveBeenCalledWith(1, 20, { action: 'share_download' }))

    await user.click(screen.getByRole('combobox', { name: 'Time range' }))
    await user.click(await screen.findByRole('option', { name: 'Last 30 days' }))

    await waitFor(() =>
      expect(listAdminAuditLogs).toHaveBeenCalledWith(
        1,
        20,
        expect.objectContaining({
          action: 'share_download',
          createdFrom: expect.any(String),
          createdTo: expect.any(String),
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() =>
      expect(listAdminAuditLogs).toHaveBeenCalledWith(
        2,
        20,
        expect.objectContaining({
          action: 'share_download',
          createdFrom: expect.any(String),
          createdTo: expect.any(String),
        }),
      ),
    )

    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }))
    await user.click(await screen.findByRole('option', { name: '50 / page' }))

    await waitFor(() =>
      expect(listAdminAuditLogs).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({
          action: 'share_download',
          createdFrom: expect.any(String),
          createdTo: expect.any(String),
        }),
      ),
    )
  })

  it('keeps the empty state visible with pagination controls', async () => {
    vi.mocked(listAdminAuditLogs).mockResolvedValue(auditPage(1, [], 0))

    renderAuditPage()

    expect(await screen.findByText('No audit events yet.')).toBeTruthy()
    expect(screen.getByText('Page 1 of 1')).toBeTruthy()
  })
})
