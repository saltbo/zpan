import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InviteDialog } from './invite-dialog'

const mocks = vi.hoisted(() => ({
  inviteMember: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/auth-client', () => ({
  authClient: { organization: { inviteMember: mocks.inviteMember, cancelInvitation: vi.fn() } },
}))

vi.mock('@/lib/rpc', () => ({
  teamsApi: {
    ':teamId': {
      invitations: { $get: vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })) },
      'invite-links': { $post: vi.fn() },
    },
  },
}))

beforeEach(() => {
  mocks.inviteMember.mockResolvedValue({ data: {}, error: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <InviteDialog open onOpenChange={vi.fn()} orgId="org-1" />
    </QueryClientProvider>,
  )
}

describe('InviteDialog email invite', () => {
  it('shows an invalid email under the email field [spec: form-errors/team-invite]', async () => {
    renderDialog()

    const email = screen.getByLabelText('teams.invite.emailLabel')
    fireEvent.change(email, { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: 'teams.invite.sendButton' }))

    const error = await screen.findByText('teams.invite.emailInvalid')
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(email.getAttribute('aria-describedby')).toBe(error.id)
    expect(mocks.inviteMember).not.toHaveBeenCalled()
  })

  it('shows a rejected invite above the send button', async () => {
    mocks.inviteMember.mockResolvedValue({ data: null, error: { message: 'User is already a member' } })
    renderDialog()

    fireEvent.change(screen.getByLabelText('teams.invite.emailLabel'), { target: { value: 'ada@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'teams.invite.sendButton' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('User is already a member')
    expect(mocks.inviteMember).toHaveBeenCalledWith({
      organizationId: 'org-1',
      email: 'ada@example.com',
      role: 'viewer',
    })
  })

  it('sends a valid invite and clears the form', async () => {
    renderDialog()

    const email = screen.getByLabelText('teams.invite.emailLabel') as HTMLInputElement
    fireEvent.change(email, { target: { value: ' ada@example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'teams.invite.sendButton' }))

    await waitFor(() =>
      expect(mocks.inviteMember).toHaveBeenCalledWith({
        organizationId: 'org-1',
        email: 'ada@example.com',
        role: 'viewer',
      }),
    )
    await waitFor(() => expect(email.value).toBe(''))
  })
})
