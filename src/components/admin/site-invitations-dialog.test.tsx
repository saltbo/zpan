import type { SiteInvitation } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SiteInvitationsDialog } from './site-invitations-dialog'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.email ? `${key}:${String(options.email)}` : key),
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/hooks/use-clipboard', () => ({ useClipboard: () => ({ copy: vi.fn() }) }))

vi.mock('@/lib/api', () => ({
  listSiteInvitations: vi.fn(),
  createSiteInvitation: vi.fn(),
  resendSiteInvitation: vi.fn(),
  revokeSiteInvitation: vi.fn(),
}))

import { listSiteInvitations, revokeSiteInvitation } from '@/lib/api'

const invitation: SiteInvitation = {
  id: 'inv-1',
  email: 'guest@example.com',
  token: 'tok',
  invitedBy: 'u1',
  invitedByName: 'Admin',
  acceptedBy: null,
  acceptedAt: null,
  revokedBy: null,
  revokedAt: null,
  expiresAt: '2026-12-31T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  status: 'pending',
}

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SiteInvitationsDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

async function openRevokeConfirm() {
  renderDialog()
  fireEvent.click(await screen.findByRole('button', { name: 'admin.users.revokeInvite' }))
  return screen.findByText('admin.users.revokeInviteConfirm:guest@example.com')
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.mocked(listSiteInvitations).mockResolvedValue({ items: [invitation], total: 1 })
  vi.mocked(revokeSiteInvitation).mockResolvedValue(undefined as never)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('SiteInvitationsDialog revoke', () => {
  it('asks for confirmation naming the email and revokes only after confirming', async () => {
    const description = await openRevokeConfirm()
    expect(revokeSiteInvitation).not.toHaveBeenCalled()

    const confirmDialog = description.closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'admin.users.revokeInvite' }))
    await waitFor(() => expect(revokeSiteInvitation).toHaveBeenCalled())
    expect(vi.mocked(revokeSiteInvitation).mock.calls[0][0]).toBe('inv-1')
  })

  it('does nothing when the confirmation is cancelled', async () => {
    const description = await openRevokeConfirm()
    const confirmDialog = description.closest('[role="dialog"]') as HTMLElement
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(screen.queryByText('admin.users.revokeInviteConfirm:guest@example.com')).toBeNull())
    expect(revokeSiteInvitation).not.toHaveBeenCalled()
  })
})
