import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import { deleteInviteCode, listInviteCodes } from '@/lib/api'

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
      <InviteCodesSection />
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
    expect(dialog.textContent).toContain('admin.auth.deleteCodeConfirm:ABCD-1234')
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
