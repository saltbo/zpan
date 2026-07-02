import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
      if (key === 'admin.users.selectPage') return 'Select page'
      if (key === 'admin.users.selectUser') return `Select ${values?.name}`
      if (key === 'admin.users.selectedCount') return `${values?.count} selected`
      if (key === 'admin.users.pageInfo') return `Page ${values?.page} of ${values?.total}`
      if (key === 'admin.users.pageSizeOption') return `${values?.count} per page`
      return key
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
  DeleteUserDialog: () => null,
}))

vi.mock('@/components/admin/site-invitations-dialog', () => ({
  SiteInvitationsDialog: () => null,
}))

vi.mock('@/lib/api', () => ({
  getUserQuotaById: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  adminListUsers: vi.fn(),
  adminRemoveUser: vi.fn(),
  adminSetUserBanned: vi.fn(),
}))

type UsersResult = Awaited<ReturnType<typeof adminListUsers>>

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function user(overrides: Partial<AdminUser>): AdminUser {
  return {
    id: 'user-1',
    name: 'Primary User',
    email: 'primary@example.com',
    username: 'primary',
    image: null,
    role: 'member',
    banned: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
    ...overrides,
  }
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

describe('UsersPage search refresh', () => {
  it('keeps the focused search input mounted while typing multiple characters and refreshing the filtered list', async () => {
    const firstPageUser = user({ id: 'user-1', name: 'Morgan One', email: 'morgan.one@example.com' })
    const secondPageUser = user({ id: 'user-2', name: 'Riley Two', email: 'riley.two@example.com' })
    const filteredUser = user({ id: 'user-3', name: 'Alice Filtered', email: 'alice@example.com' })
    const pendingSearches = new Map<string, ReturnType<typeof createDeferred<UsersResult>>>()

    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(adminListUsers).mockImplementation(({ offset, search }) => {
      if (search) {
        const pending = createDeferred<UsersResult>()
        pendingSearches.set(search, pending)
        return pending.promise
      }

      return Promise.resolve({
        users: [offset === 20 ? secondPageUser : firstPageUser],
        total: 40,
      })
    })

    const typingUser = userEvent.setup()
    renderUsersPage()

    expect(await screen.findByText('Morgan One')).toBeTruthy()
    await typingUser.click(screen.getByRole('button', { name: 'admin.users.nextPage' }))
    expect(await screen.findByText('Riley Two')).toBeTruthy()

    await typingUser.click(screen.getByRole('checkbox', { name: 'Select Riley Two' }))
    expect(screen.getByText('1 selected')).toBeTruthy()

    const searchInput = screen.getByPlaceholderText('admin.users.searchPlaceholder') as HTMLInputElement
    await typingUser.click(searchInput)
    await typingUser.type(searchInput, 'ali')

    expect(searchInput.value).toBe('ali')
    expect(document.activeElement).toBe(searchInput)
    expect(screen.getByPlaceholderText('admin.users.searchPlaceholder')).toBe(searchInput)
    expect(screen.getByText('admin.users.title')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('common.loading')
    expect(screen.queryByText('1 selected')).toBeNull()

    await waitFor(() => expect(adminListUsers).toHaveBeenCalledWith({ limit: 20, offset: 0, search: 'ali' }))

    pendingSearches.get('ali')?.resolve({ users: [filteredUser], total: 1 })

    expect(await screen.findByText('Alice Filtered')).toBeTruthy()
    expect(screen.queryByText('Riley Two')).toBeNull()
    expect(document.activeElement).toBe(searchInput)
  })
})
