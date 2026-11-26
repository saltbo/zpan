import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { InviteCode } from '@/lib/api'
import { InviteCodesSection } from './invite-codes-section'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.code ? `${key}:${String(options.code)}` : key),
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', () => ({
  listInviteCodes: vi.fn(),
  generateInviteCodes: vi.fn(),
  deleteInviteCode: vi.fn(),
}))

import { toast } from 'sonner'
import { deleteInviteCode, generateInviteCodes, listInviteCodes } from '@/lib/api'

const code = {
  id: 'code-1',
  code: 'ABCD-1234',
  usedBy: null,
  usedAt: null,
  expiresAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
} as unknown as InviteCode

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <InviteCodesSection />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.mocked(listInviteCodes).mockResolvedValue({ items: [code], total: 1 } as never)
  vi.mocked(deleteInviteCode).mockResolvedValue(undefined as never)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('InviteCodesSection delete', () => {
  it('asks for confirmation naming the code and deletes only after confirming', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('admin.auth.deleteCodeTitle:ABCD-1234')
    expect(dialog.textContent).toContain('admin.auth.deleteCodeConfirm')
    expect(deleteInviteCode).not.toHaveBeenCalled()

    const buttons = dialog.querySelectorAll('button')
    const confirm = Array.from(buttons).find((b) => b.textContent === 'common.delete')
    fireEvent.click(confirm!)
    await waitFor(() => expect(deleteInviteCode).toHaveBeenCalled())
    expect(vi.mocked(deleteInviteCode).mock.calls[0][0]).toBe('code-1')
  })

  it('does nothing when the confirmation is cancelled', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }))
    const dialog = await screen.findByRole('dialog')
    const cancel = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'common.cancel')
    fireEvent.click(cancel!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteInviteCode).not.toHaveBeenCalled()
  })
})

describe('InviteCodesSection list', () => {
  it('lists codes with their status and offers delete only for available codes [spec: invite-codes/admin-console-manage]', async () => {
    vi.mocked(listInviteCodes).mockResolvedValue({
      items: [code, { ...code, id: 'code-2', code: 'USED-0001', usedBy: 'user-1' }],
      total: 2,
    } as never)
    renderSection()
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByText('USED-0001')).toBeTruthy()
    expect(screen.getByText('admin.auth.statusAvailable')).toBeTruthy()
    expect(screen.getByText('admin.auth.statusUsed')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'common.delete' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'admin.auth.copyCode' })).toHaveLength(2)
  })

  it('copies a code from its row action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'admin.auth.copyCode' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABCD-1234'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('admin.auth.codeCopied'))
  })

  it('shows an empty state whose action opens the generate drawer', async () => {
    vi.mocked(listInviteCodes).mockResolvedValue({ items: [], total: 0 } as never)
    vi.mocked(generateInviteCodes).mockResolvedValue({ items: [] } as never)
    renderSection()
    expect(await screen.findByText('admin.auth.noInviteCodes')).toBeTruthy()
    expect(screen.getByText('admin.auth.noInviteCodesHint')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'admin.auth.generateCodes' }))

    fireEvent.change(await screen.findByLabelText(/admin.auth.codeCount/), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/admin.auth.expiresInDays/), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.create' }))
    await waitFor(() => expect(generateInviteCodes).toHaveBeenCalledWith(3, 7))
  })

  it('shows an inline error with retry when the list fails to load', async () => {
    vi.mocked(listInviteCodes).mockRejectedValueOnce(new Error('boom'))
    renderSection()
    expect(await screen.findByText('admin.auth.inviteCodesLoadFailed')).toBeTruthy()
    vi.mocked(listInviteCodes).mockResolvedValue({ items: [code], total: 1 } as never)
    fireEvent.click(screen.getByRole('button', { name: 'admin.overview.retry' }))
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
  })
})
