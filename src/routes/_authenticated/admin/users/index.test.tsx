import type { AdminUserListItem } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserQuotaById, listUsers } from '@/lib/api'
import { routerSearch } from '@/test/router-search'
import { adminUsersSearchSchema, UsersPage } from './index'

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
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === 'admin.users.selectPage') return 'Select page'
      if (key === 'admin.users.selectUser') return `Select ${values?.name}`
      if (key === 'admin.users.selectedCount') return `${values?.count} selected`
      if (key === 'common.previousPage') return 'Previous'
      if (key === 'common.nextPage') return 'Next'
      if (key === 'common.rowsPerPage') return 'Rows per page'
      if (key === 'common.pageSizeOption') return `${values?.count} per page`
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
  listUsers: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  adminRemoveUser: vi.fn(),
  adminSetUserBanned: vi.fn(),
}))

type UsersResult = Awaited<ReturnType<typeof listUsers>>

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function user(overrides: Partial<AdminUserListItem>): AdminUserListItem {
  return {
    id: 'user-1',
    name: 'Primary User',
    email: 'primary@example.com',
    username: 'primary',
    image: null,
    role: 'member',
    banned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
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
  routerSearch.reset()
})

describe('UsersPage list state in the URL', () => {
  it('restores search and page size from the link, starting on the first page [spec: list-state/admin-users]', async () => {
    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(listUsers).mockResolvedValue({
      items: [user({ id: 'user-9', name: 'Alice Paged', email: 'alice@example.com' })],
      nextPageToken: 'tok-2',
    })
    routerSearch.reset(adminUsersSearchSchema.parse({ q: 'ali', size: 50 }))
    const clickingUser = userEvent.setup()

    renderUsersPage()

    expect(await screen.findByText('Alice Paged')).toBeTruthy()
    expect(listUsers).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 50, search: 'ali' })
    expect((screen.getByPlaceholderText('admin.users.searchPlaceholder') as HTMLInputElement).value).toBe('ali')
    expect(routerSearch.search).toEqual({ q: 'ali', size: 50 })

    await clickingUser.type(screen.getByPlaceholderText('admin.users.searchPlaceholder'), 'c')
    expect(routerSearch.search).toEqual({ q: 'alic', size: 50 })
    expect(routerSearch.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }))
  })

  it('writes a changed page size to the link without a page or token', async () => {
    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(listUsers).mockResolvedValue({ items: [user({})], nextPageToken: 'tok-2' })
    routerSearch.reset(adminUsersSearchSchema.parse({ q: 'ali' }))
    const clickingUser = userEvent.setup()
    Element.prototype.scrollIntoView = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()

    renderUsersPage()
    expect(await screen.findByText('Primary User')).toBeTruthy()

    await clickingUser.click(screen.getByRole('combobox', { name: 'Rows per page' }))
    await clickingUser.click(await screen.findByRole('option', { name: '50 per page' }))

    expect(routerSearch.search).toEqual({ q: 'ali', size: 50 })
    await waitFor(() => expect(listUsers).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 50, search: 'ali' }))
  })
})

describe('UsersPage cursor pagination', () => {
  it('requests the next page with the previous response token and returns with Previous [spec: list-pagination/admin-tables]', async () => {
    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(listUsers).mockImplementation(async ({ pageToken } = {}) =>
      pageToken === 'tok-2'
        ? { items: [user({ id: 'user-2', name: 'Riley Two', email: 'riley@example.com' })], nextPageToken: null }
        : { items: [user({ id: 'user-1', name: 'Morgan One' })], nextPageToken: 'tok-2' },
    )
    const clickingUser = userEvent.setup()

    renderUsersPage()

    expect(await screen.findByText('Morgan One')).toBeTruthy()
    expect(listUsers).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 20, search: '' })
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(/Page \d+ of/)).toBeNull()

    await clickingUser.click(screen.getByRole('checkbox', { name: 'Select Morgan One' }))
    expect(screen.getByText('1 selected')).toBeTruthy()

    await clickingUser.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Riley Two')).toBeTruthy()
    expect(listUsers).toHaveBeenCalledWith({ pageToken: 'tok-2', pageSize: 20, search: '' })
    expect(screen.queryByText('1 selected')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true)

    await clickingUser.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Morgan One')).toBeTruthy()
    expect(screen.queryByText('Riley Two')).toBeNull()
  })

  it('returns to the first page when the search changes [spec: list-pagination/page-size]', async () => {
    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(listUsers).mockImplementation(async ({ pageToken, search } = {}) =>
      search
        ? { items: [user({ id: 'user-3', name: 'Alice Filtered' })], nextPageToken: null }
        : pageToken
          ? { items: [user({ id: 'user-2', name: 'Riley Two' })], nextPageToken: null }
          : { items: [user({ id: 'user-1', name: 'Morgan One' })], nextPageToken: 'tok-2' },
    )
    const clickingUser = userEvent.setup()

    renderUsersPage()
    expect(await screen.findByText('Morgan One')).toBeTruthy()
    await clickingUser.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Riley Two')).toBeTruthy()

    await clickingUser.type(screen.getByPlaceholderText('admin.users.searchPlaceholder'), 'ali')

    expect(await screen.findByText('Alice Filtered')).toBeTruthy()
    const last = vi.mocked(listUsers).mock.calls.at(-1)?.[0]
    expect(last).toEqual({ pageToken: undefined, pageSize: 20, search: 'ali' })
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('UsersPage search refresh', () => {
  it('keeps the focused search input mounted while loading filtered results without retaining stale rows', async () => {
    const firstPageUser = user({ id: 'user-1', name: 'Morgan One', email: 'morgan.one@example.com' })
    const secondPageUser = user({ id: 'user-2', name: 'Riley Two', email: 'riley.two@example.com' })
    const filteredUser = user({ id: 'user-3', name: 'Alice Filtered', email: 'alice@example.com' })
    const pendingSearches = new Map<string, ReturnType<typeof createDeferred<UsersResult>>>()

    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(listUsers).mockImplementation(({ pageToken, search } = {}) => {
      if (search) {
        const pending = createDeferred<UsersResult>()
        pendingSearches.set(search, pending)
        return pending.promise
      }

      return Promise.resolve(
        pageToken === 'tok-2'
          ? { items: [secondPageUser], nextPageToken: null }
          : { items: [firstPageUser], nextPageToken: 'tok-2' },
      )
    })

    const typingUser = userEvent.setup()
    renderUsersPage()

    expect(await screen.findByText('Morgan One')).toBeTruthy()
    await typingUser.click(screen.getByRole('button', { name: 'Next' }))
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
    expect(screen.queryByText('Riley Two')).toBeNull()
    expect(screen.queryByText('1 selected')).toBeNull()

    await waitFor(() => expect(listUsers).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 20, search: 'ali' }))

    pendingSearches.get('ali')?.resolve({ items: [filteredUser], nextPageToken: null })

    expect(await screen.findByText('Alice Filtered')).toBeTruthy()
    expect(screen.queryByText('Riley Two')).toBeNull()
    expect(document.activeElement).toBe(searchInput)
  })
})
