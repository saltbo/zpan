import type { AdminUserListItem } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getUserQuotaById, listUsers } from '@/lib/api'
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
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', () => ({ getUserQuotaById: vi.fn(), listUsers: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
  adminSetUserBanned: vi.fn(),
}))

function user(id: string, name: string): AdminUserListItem {
  return {
    id,
    name,
    email: `${id}@example.com`,
    username: id,
    image: null,
    role: 'member',
    banned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = []
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()

  constructor(readonly callback: IntersectionObserverCallback) {
    IntersectionObserverStub.instances.push(this)
  }

  intersect() {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }

  static get live() {
    return IntersectionObserverStub.instances.filter((instance) => instance.disconnect.mock.calls.length === 0)
  }
}

beforeEach(() => {
  IntersectionObserverStub.instances = []
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
})

function renderUsersPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <UsersPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  vi.clearAllMocks()
  routerSearch.reset()
})

describe('UsersPage list state in the URL', () => {
  it('restores search from the link and writes changes back [spec: list-state/users]', async () => {
    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(listUsers).mockResolvedValue({
      items: [user('alice', 'Alice'), user('bob', 'Bob')],
      nextPageToken: null,
    })
    routerSearch.reset(usersSearchSchema.parse({ q: 'ali' }))

    renderUsersPage()

    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(screen.queryByText('Bob')).toBeNull()
    expect(listUsers).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 20 })

    fireEvent.change(await screen.findByPlaceholderText('admin.users.searchPlaceholder'), { target: { value: 'bo' } })
    expect(routerSearch.search).toEqual({ q: 'bo' })
    expect(routerSearch.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }))
  })
})

describe('UsersPage infinite scroll', () => {
  it('shows no page controls and appends the next page when the end is reached [spec: list-pagination/scroll]', async () => {
    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(listUsers).mockImplementation(async ({ pageToken } = {}) =>
      pageToken === 'tok-2'
        ? { items: [user('carol', 'Carol')], nextPageToken: null }
        : { items: [user('alice', 'Alice')], nextPageToken: 'tok-2' },
    )

    renderUsersPage()

    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /nextPage|Next/ })).toBeNull()
    expect(listUsers).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(IntersectionObserverStub.live).toHaveLength(1))
    act(() => IntersectionObserverStub.live[0].intersect())

    expect(await screen.findByText('Carol')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(listUsers).toHaveBeenLastCalledWith({ pageToken: 'tok-2', pageSize: 20 })

    // The last page has no next token, so nothing observes the end of the list any more.
    await waitFor(() => expect(IntersectionObserverStub.live).toHaveLength(0))
    expect(listUsers).toHaveBeenCalledTimes(2)
  })
})

describe('UsersPage while searching', () => {
  it('keeps the header, search field, and table mounted [spec: list-state/refetch-keeps-layout]', async () => {
    vi.mocked(getUserQuotaById).mockResolvedValue({ used: 0, total: 1024, hasPersonalOrg: true })
    vi.mocked(listUsers).mockResolvedValue({ items: [user('alice', 'Alice'), user('bob', 'Bob')], nextPageToken: null })

    renderUsersPage()

    const field = await screen.findByPlaceholderText('admin.users.searchPlaceholder')
    field.focus()
    fireEvent.change(field, { target: { value: 'bo' } })

    expect(screen.queryByText('common.loading')).toBeNull()
    expect(screen.getByPlaceholderText('admin.users.searchPlaceholder')).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.queryByText('Alice')).toBeNull()
    expect(listUsers).toHaveBeenCalledTimes(1)
  })
})
