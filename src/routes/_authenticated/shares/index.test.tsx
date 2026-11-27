import type { ShareListItem } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listReceivedShares, listShares, revokeShare, setSharePrivacy } from '@/lib/api'
import { SharesPage } from './index'

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: { status: 'all', box: 'sent' },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${Object.values(values).join('/')}` : key),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => router.navigate,
  useSearch: () => router.search,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/hooks/use-clipboard', () => ({
  useClipboard: () => ({ copy: vi.fn() }),
}))

vi.mock('@/components/layout/page-header', () => ({
  PageHeader: () => null,
}))

vi.mock('@/components/shares/share-detail-panel', () => ({
  ShareDetailPanel: () => null,
}))

vi.mock('@/components/shares/revoke-confirm-dialog', () => ({
  RevokeConfirmDialog: () => null,
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/lib/api')>()).ApiError,
  listReceivedShares: vi.fn(),
  listShares: vi.fn(),
  revokeShare: vi.fn(),
  setSharePrivacy: vi.fn(),
}))

function share(overrides: Partial<ShareListItem>): ShareListItem {
  return {
    id: 'share-1',
    token: 'sShareTok001',
    kind: 'landing',
    matterId: 'matter-1',
    orgId: 'org-1',
    creatorId: 'user-1',
    expiresAt: null,
    downloadLimit: null,
    views: 2,
    downloads: 1,
    status: 'active',
    private: false,
    createdAt: '2026-07-23T00:00:00.000Z',
    matter: {
      name: 'Public file.pdf',
      type: 'application/pdf',
      dirtype: 0,
    },
    recipientCount: 0,
    ...overrides,
  }
}

const shares = [
  share({ token: 'public-token', matter: { name: 'Public.pdf', type: 'application/pdf', dirtype: 0 } }),
  share({
    id: 'share-2',
    token: 'private-token',
    private: true,
    matter: { name: 'Private folder', type: 'folder', dirtype: 1 },
  }),
  share({
    id: 'share-3',
    token: 'direct-token',
    kind: 'direct',
    matter: { name: 'Direct file.pdf', type: 'application/pdf', dirtype: 0 },
  }),
]

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SharesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(listShares).mockResolvedValue({ items: shares, nextPageToken: null })
  vi.mocked(listReceivedShares).mockResolvedValue({ items: [], nextPageToken: null })
  vi.mocked(setSharePrivacy).mockResolvedValue({ private: true })
  vi.mocked(revokeShare).mockResolvedValue({} as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('authenticated Shares privacy actions', () => {
  it('makes a public share private and a private share public', async () => {
    renderPage()

    expect(await screen.findByText('Public.pdf')).toBeTruthy()
    const publicButton = screen
      .getAllByTitle('shares.makePrivate')
      .find((button) => button.closest('tr')?.textContent?.includes('Public.pdf'))
    fireEvent.click(publicButton!)
    await waitFor(() => expect(setSharePrivacy).toHaveBeenCalledWith('public-token', true))

    fireEvent.click(screen.getByTitle('shares.makePublic'))
    await waitFor(() => expect(setSharePrivacy).toHaveBeenCalledWith('private-token', false))
  })

  it('disables privacy changes for an ineligible direct share', async () => {
    renderPage()

    expect(await screen.findByText('Direct file.pdf')).toBeTruthy()
    const privacyButtons = screen.getAllByTitle('shares.makePrivate')
    const directButton = privacyButtons.find((button) => button.closest('tr')?.textContent?.includes('Direct file.pdf'))

    expect(directButton?.hasAttribute('disabled')).toBe(true)
    fireEvent.click(directButton!)
    expect(setSharePrivacy).not.toHaveBeenCalled()
  })

  it('keeps privacy changes available when a landing share has expired', async () => {
    const expiredPublic = share({
      token: 'expired-public-token',
      expiresAt: '2000-01-01T00:00:00.000Z',
      matter: { name: 'Expired public.pdf', type: 'application/pdf', dirtype: 0 },
    })
    vi.mocked(listShares).mockResolvedValue({
      items: [expiredPublic],
      nextPageToken: null,
    })

    renderPage()

    expect(await screen.findByText('Expired public.pdf')).toBeTruthy()
    const privateButton = screen.getByTitle('shares.makePrivate')
    expect(privateButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(privateButton)
    await waitFor(() => expect(setSharePrivacy).toHaveBeenCalledWith('expired-public-token', true))
  })
})

describe('authenticated Shares load failure', () => {
  it('shows an inline alert with retry instead of the empty state, and retry loads the list [spec: load-errors/shares-list]', async () => {
    vi.mocked(listShares).mockReset()
    vi.mocked(listShares)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ items: shares, nextPageToken: null })
    renderPage()

    expect(await screen.findByText('common.loadError.title')).toBeTruthy()
    expect(screen.getByText('common.loadError.description')).toBeTruthy()
    expect(screen.queryByText('shares.emptyState')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))

    expect(await screen.findByText('Public.pdf')).toBeTruthy()
    expect(screen.queryByText('common.loadError.title')).toBeNull()
  })
})

describe('authenticated Shares while a new filter loads', () => {
  afterEach(() => {
    router.search = { status: 'all', box: 'sent' }
  })

  it('keeps the toolbar and the previous rows, dimmed, until the new rows arrive [spec: list-state/refetch-keeps-layout]', async () => {
    let resolveRevoked: (page: { items: ShareListItem[]; nextPageToken: null }) => void = () => {}
    vi.mocked(listShares).mockImplementation((_token, _size, status) =>
      status === 'revoked'
        ? new Promise((resolve) => {
            resolveRevoked = resolve
          })
        : Promise.resolve({ items: shares, nextPageToken: null }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const page = () => (
      <QueryClientProvider client={queryClient}>
        <SharesPage />
      </QueryClientProvider>
    )
    const view = render(page())
    expect(await screen.findByText('Public.pdf')).toBeTruthy()

    router.search = { status: 'revoked', box: 'sent' }
    view.rerender(page())

    await waitFor(() => expect(listShares).toHaveBeenCalledWith(undefined, expect.any(Number), 'revoked'))
    expect(screen.queryByText('common.loading')).toBeNull()
    expect(screen.getByTestId('shares-toolbar')).toBeTruthy()
    expect(screen.getByText('Public.pdf').closest('tbody')?.getAttribute('aria-busy')).toBe('true')

    resolveRevoked({
      items: [
        share({
          token: 'revoked-token',
          status: 'revoked',
          matter: { name: 'Revoked.pdf', type: 'application/pdf', dirtype: 0 },
        }),
      ],
      nextPageToken: null,
    })

    expect(await screen.findByText('Revoked.pdf')).toBeTruthy()
    expect(screen.queryByText('Public.pdf')).toBeNull()
    expect(screen.getByText('Revoked.pdf').closest('tbody')?.getAttribute('aria-busy')).toBe('false')
  })

  it('shows the loading state on the first load', () => {
    vi.mocked(listShares).mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByText('common.loading')).toBeTruthy()
    expect(screen.queryByTestId('shares-toolbar')).toBeNull()
  })
})
