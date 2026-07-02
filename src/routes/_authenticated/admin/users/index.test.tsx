import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserQuotaById } from '@/lib/api'
import { type AdminUser, adminListUsers } from '@/lib/auth-client'
import { UsersPage } from './index'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
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

vi.mock('@/components/admin/delete-user-dialog', () => ({
  DeleteUserDialog: () => <div data-testid="delete-user-dialog" />,
}))

vi.mock('@/components/admin/site-invitations-dialog', () => ({
  SiteInvitationsDialog: () => <div data-testid="site-invitations-dialog" />,
}))

vi.mock('@/lib/api', () => ({
  getUserQuotaById: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  adminListUsers: vi.fn(),
  adminRemoveUser: vi.fn(),
  adminSetUserBanned: vi.fn(),
}))

const adminUser: AdminUser = {
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  username: 'ada',
  image: null,
  role: 'admin',
  banned: false,
  createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
}

function renderUsersPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <UsersPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UsersPage search', () => {
  it('keeps the search input mounted and focused while filtered results refresh', async () => {
    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(adminListUsers).mockImplementation(({ search }) => {
      if (search) return new Promise(() => {})
      return Promise.resolve({ users: [adminUser], total: 1 })
    })

    renderUsersPage()

    const searchInput = (await screen.findByPlaceholderText('admin.users.searchPlaceholder')) as HTMLInputElement
    searchInput.focus()
    expect(document.activeElement).toBe(searchInput)

    fireEvent.change(searchInput, { target: { value: 'a' } })

    await waitFor(() => expect(adminListUsers).toHaveBeenCalledWith({ limit: 20, offset: 0, search: 'a' }))
    expect(searchInput.value).toBe('a')
    expect(searchInput.isConnected).toBe(true)
    expect(document.activeElement).toBe(searchInput)
    expect(screen.getByRole('status').textContent).toBe('common.loading')

    fireEvent.change(searchInput, { target: { value: 'ab' } })

    await waitFor(() => expect(adminListUsers).toHaveBeenCalledWith({ limit: 20, offset: 0, search: 'ab' }))
    expect(searchInput.value).toBe('ab')
    expect(searchInput.isConnected).toBe(true)
    expect(document.activeElement).toBe(searchInput)
  })
})
