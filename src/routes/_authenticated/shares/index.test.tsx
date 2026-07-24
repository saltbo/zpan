import type { ShareListItem } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listReceivedShares, listShareOnProfile, listShares, revokeShare, unlistShareFromProfile } from '@/lib/api'
import { SharesPage } from './index'

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: { status: 'all', page: 1, box: 'sent' },
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

vi.mock('@/lib/api', () => ({
  listReceivedShares: vi.fn(),
  listShareOnProfile: vi.fn(),
  listShares: vi.fn(),
  revokeShare: vi.fn(),
  unlistShareFromProfile: vi.fn(),
}))

function share(overrides: Partial<ShareListItem>): ShareListItem {
  return {
    id: 'share-1',
    token: 'share-token',
    kind: 'landing',
    matterId: 'matter-1',
    orgId: 'org-1',
    creatorId: 'user-1',
    expiresAt: null,
    downloadLimit: null,
    views: 2,
    downloads: 1,
    status: 'active',
    listedAt: null,
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
  share({ token: 'unlisted-token', matter: { name: 'Unlisted.pdf', type: 'application/pdf', dirtype: 0 } }),
  share({
    id: 'share-2',
    token: 'listed-token',
    listedAt: '2026-07-23T01:00:00.000Z',
    matter: { name: 'Listed folder', type: 'folder', dirtype: 1 },
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
  vi.mocked(listShares).mockResolvedValue({ items: shares, total: shares.length, page: 1, pageSize: 20 })
  vi.mocked(listReceivedShares).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  vi.mocked(listShareOnProfile).mockResolvedValue({ listedAt: '2026-07-23T02:00:00.000Z' })
  vi.mocked(unlistShareFromProfile).mockResolvedValue(undefined)
  vi.mocked(revokeShare).mockResolvedValue({} as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('authenticated Shares profile listing actions', () => {
  it('lists an eligible landing share and unlists an already listed share', async () => {
    renderPage()

    expect(await screen.findByText('Unlisted.pdf')).toBeTruthy()
    fireEvent.click(screen.getAllByTitle('shares.listOnProfile')[0])
    await waitFor(() => expect(listShareOnProfile).toHaveBeenCalledWith('unlisted-token'))

    fireEvent.click(screen.getByTitle('shares.unlistFromProfile'))
    await waitFor(() => expect(unlistShareFromProfile).toHaveBeenCalledWith('listed-token'))
  })

  it('disables profile listing for an ineligible direct share', async () => {
    renderPage()

    expect(await screen.findByText('Direct file.pdf')).toBeTruthy()
    const listButtons = screen.getAllByTitle('shares.listOnProfile')
    const directButton = listButtons.find((button) => button.closest('tr')?.textContent?.includes('Direct file.pdf'))

    expect(directButton?.hasAttribute('disabled')).toBe(true)
    fireEvent.click(directButton!)
    expect(listShareOnProfile).not.toHaveBeenCalled()
  })

  it('keeps unlisting available when an already listed landing share has expired', async () => {
    const expiredListed = share({
      token: 'expired-listed-token',
      expiresAt: '2000-01-01T00:00:00.000Z',
      listedAt: '1999-12-01T00:00:00.000Z',
      matter: { name: 'Expired listed.pdf', type: 'application/pdf', dirtype: 0 },
    })
    vi.mocked(listShares).mockResolvedValue({
      items: [expiredListed],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    renderPage()

    expect(await screen.findByText('Expired listed.pdf')).toBeTruthy()
    const unlistButton = screen.getByTitle('shares.unlistFromProfile')
    expect(unlistButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(unlistButton)
    await waitFor(() => expect(unlistShareFromProfile).toHaveBeenCalledWith('expired-listed-token'))
  })
})
