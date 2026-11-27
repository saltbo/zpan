import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InviteUserDrawer } from './invite-user-drawer'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({ createSiteInvitation: vi.fn() }))

import { toast } from 'sonner'
import { createSiteInvitation } from '@/lib/api'

function renderDrawer(props: { onOpenChange?: (open: boolean) => void; onInvited?: () => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <InviteUserDrawer open onOpenChange={props.onOpenChange ?? vi.fn()} onInvited={props.onInvited} />
    </QueryClientProvider>,
  )
}

function typeEmail(value: string) {
  const input = screen.getByPlaceholderText('admin.users.inviteEmailPlaceholder')
  fireEvent.change(input, { target: { value } })
  return input
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InviteUserDrawer', () => {
  it('holds only the invite form, with Cancel and Send invite in its footer [spec: site-invitations/list-apart-from-form]', () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('table')).toBeNull()
    expect(screen.queryByRole('button', { name: 'common.nextPage' })).toBeNull()

    const footer = screen.getByRole('button', { name: 'admin.users.sendInvite' }).parentElement as HTMLElement
    const buttons = Array.from(footer.querySelectorAll('button')).map((button) => button.textContent)
    expect(buttons).toEqual(['common.cancel', 'admin.users.sendInvite'])
    expect((screen.getByRole('button', { name: 'admin.users.sendInvite' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends the trimmed email, then closes and reports the invite', async () => {
    vi.mocked(createSiteInvitation).mockResolvedValue({} as never)
    const onOpenChange = vi.fn()
    const onInvited = vi.fn()
    renderDrawer({ onOpenChange, onInvited })

    typeEmail('  new@example.com ')
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.sendInvite' }))

    await waitFor(() => expect(onInvited).toHaveBeenCalled())
    expect(vi.mocked(createSiteInvitation).mock.calls[0][0]).toBe('new@example.com')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toast.success).toHaveBeenCalledWith('admin.users.inviteCreated')
  })

  it('shows a rejected invite under the email field and clears it on edit [spec: form-errors/site-invite]', async () => {
    vi.mocked(createSiteInvitation).mockRejectedValue(new Error('Configure email delivery before sending invitations'))
    const onOpenChange = vi.fn()
    renderDrawer({ onOpenChange })

    const input = typeEmail('new@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.sendInvite' }))

    const error = await screen.findByText('Configure email delivery before sending invitations')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
    expect(input.parentElement?.contains(error)).toBe(true)
    expect(input.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()

    typeEmail('other@example.com')
    await waitFor(() => expect(screen.queryByText('Configure email delivery before sending invitations')).toBeNull())
  })
})
