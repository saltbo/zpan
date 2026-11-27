import type { InviteCodeListItem } from '@shared/schemas'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
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

vi.mock('@/lib/api', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/lib/api')>()).ApiError,
  listInviteCodes: vi.fn(),
  generateInviteCodes: vi.fn(),
  deleteInviteCode: vi.fn(),
}))

import { toast } from 'sonner'
import { ApiError, deleteInviteCode, generateInviteCodes, listInviteCodes } from '@/lib/api'

const code = {
  id: 'code-1',
  code: 'ABCD-1234',
  usedBy: null,
  usedAt: null,
  expiresAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
} as unknown as InviteCodeListItem

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
  vi.mocked(listInviteCodes).mockResolvedValue({ items: [code], nextPageToken: null })
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
      nextPageToken: null,
    })
    renderSection()
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByText('USED-0001')).toBeTruthy()
    expect(screen.getByText('admin.auth.statusAvailable')).toBeTruthy()
    expect(screen.getByText('admin.auth.statusUsed')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'common.delete' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'admin.auth.copyCode' })).toHaveLength(2)
  })

  it('shows who redeemed each used code and marks a deleted redeemer [spec: invite-codes/admin-console-redeemer]', async () => {
    vi.mocked(listInviteCodes).mockResolvedValue({
      items: [
        {
          ...code,
          id: 'code-2',
          code: 'USED-0001',
          usedBy: 'user-1',
          usedByUser: { name: 'Ada Lovelace', email: 'ada@example.com' },
        },
        { ...code, id: 'code-3', code: 'USED-0002', usedBy: 'user-gone' },
      ],
      nextPageToken: null,
    })
    renderSection()
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('ada@example.com')).toBeTruthy()
    expect(screen.queryByText('user-1')).toBeNull()
    const deleted = screen.getByText('admin.auth.deletedUser')
    expect(deleted.closest('td')?.getAttribute('title')).toBe('user-gone')
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
    vi.mocked(listInviteCodes).mockResolvedValue({ items: [], nextPageToken: null })
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
    vi.mocked(listInviteCodes).mockResolvedValue({ items: [code], nextPageToken: null })
    fireEvent.click(screen.getByRole('button', { name: 'admin.overview.retry' }))
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
  })

  it('pages through every code with the previous response token [spec: list-pagination/invite-codes-beyond-first-page]', async () => {
    const second = { ...code, id: 'code-2', code: 'PAGE-0002' } as InviteCodeListItem
    vi.mocked(listInviteCodes).mockImplementation(async (opts) =>
      opts?.pageToken === 'tok-2'
        ? { items: [second], nextPageToken: null }
        : { items: [code], nextPageToken: 'tok-2' },
    )
    renderSection()

    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(listInviteCodes).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 20 })
    expect((screen.getByRole('button', { name: 'common.previousPage' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'common.nextPage' }))
    expect(await screen.findByText('PAGE-0002')).toBeTruthy()
    expect(listInviteCodes).toHaveBeenLastCalledWith({ pageToken: 'tok-2', pageSize: 20 })
    // An unused code on a later page can still be deleted.
    expect(screen.getAllByRole('button', { name: 'common.delete' })).toHaveLength(1)
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'common.nextPage' }) as HTMLButtonElement).disabled).toBe(true),
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.previousPage' }))
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.queryByText('PAGE-0002')).toBeNull()
  })

  it('returns to the page before when the last code on a later page is deleted [spec: list-pagination/empty-later-page]', async () => {
    const second = { ...code, id: 'code-2', code: 'PAGE-0002' } as InviteCodeListItem
    let secondDeleted = false
    vi.mocked(deleteInviteCode).mockImplementation((async () => {
      secondDeleted = true
    }) as never)
    vi.mocked(listInviteCodes).mockImplementation(async (opts) => {
      if (opts?.pageToken === 'tok-2') return { items: secondDeleted ? [] : [second], nextPageToken: null }
      return { items: [code], nextPageToken: secondDeleted ? null : 'tok-2' }
    })
    renderSection()

    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'common.nextPage' }))
    expect(await screen.findByText('PAGE-0002')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'common.delete')
    fireEvent.click(confirm!)

    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.queryByText('PAGE-0002')).toBeNull()
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'common.previousPage' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'common.nextPage' }) as HTMLButtonElement).disabled).toBe(true)
    })
  })

  it('shows a value the server rejects under its field [spec: form-errors/admin-drawer]', async () => {
    vi.mocked(generateInviteCodes).mockRejectedValue(
      new ApiError(400, {
        error: {
          code: 400,
          message: 'Invalid value for count',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'INVALID_ARGUMENT', domain: 'zpan.dev', metadata: { field: 'count' } }],
        },
      }),
    )
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'admin.auth.generateCodes' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.create' }))

    const error = await screen.findByText('Invalid value for count')
    const count = screen.getByLabelText('admin.auth.codeCount')
    expect(count.getAttribute('aria-invalid')).toBe('true')
    expect(count.getAttribute('aria-describedby')).toContain(error.id)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows a rejected generate that names no field above the create button', async () => {
    vi.mocked(generateInviteCodes).mockRejectedValue(new Error('Invite codes are disabled'))
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'admin.auth.generateCodes' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.create' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Invite codes are disabled')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
