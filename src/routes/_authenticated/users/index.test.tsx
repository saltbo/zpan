import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserQuotaById } from '@/lib/api'
import { type AdminUser, adminListUsers } from '@/lib/auth-client'
import { routerSearch } from '@/test/router-search'
import { UsersPage, usersSearchSchema } from './index'

vi.mock('@tanstack/react-router', async () => {
  const { routerSearch } = await import('@/test/router-search')
  return {
    createFileRoute: () => (options: unknown) => options,
    useNavigate: routerSearch.useNavigate,
    useSearch: routerSearch.useSearch,
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key === 'admin.users.pageInfo' ? `Page ${values?.page} of ${values?.total}` : key,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', () => ({ getUserQuotaById: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
  adminListUsers: vi.fn(),
  adminSetUserBanned: vi.fn(),
}))

function user(id: string, name: string): AdminUser {
  return {
    id,
    name,
    email: `${id}@example.com`,
    username: id,
    image: null,
    role: 'member',
    banned: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
  }
}

function renderUsersPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <UsersPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  routerSearch.reset()
})

describe('UsersPage list state in the URL', () => {
  it('restores search and page from the link and writes changes back [spec: list-state/users]', async () => {
    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(adminListUsers).mockResolvedValue({
      users: [user('alice', 'Alice'), user('bob', 'Bob')],
      total: 60,
    })
    routerSearch.reset(usersSearchSchema.parse({ q: 'ali', page: 2 }))

    renderUsersPage()

    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(screen.queryByText('Bob')).toBeNull()
    expect(adminListUsers).toHaveBeenCalledWith({ limit: 20, offset: 20 })
    expect(screen.getByText('Page 2 of 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'admin.users.nextPage' }))
    expect(routerSearch.search).toEqual({ q: 'ali', page: 3 })
    await waitFor(() => expect(adminListUsers).toHaveBeenCalledWith({ limit: 20, offset: 40 }))

    fireEvent.change(await screen.findByPlaceholderText('admin.users.searchPlaceholder'), { target: { value: 'bo' } })
    expect(routerSearch.search).toEqual({ q: 'bo' })
    expect(routerSearch.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }))
  })
})
