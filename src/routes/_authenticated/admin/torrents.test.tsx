import type { AdminTorrent, TorrentCacheSettings } from '@shared/schemas'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEntitlement } from '@/hooks/useEntitlement'
import { evictCachedTorrent, getTorrentCacheSettings, listCachedTorrents, replaceTorrentCacheSettings } from '@/lib/api'
import { Route } from './torrents'

const navigate = vi.fn()
let search: { size?: number } = {}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => options,
  useNavigate: () => navigate,
  useSearch: () => search,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/hooks/useEntitlement', () => ({ useEntitlement: vi.fn() }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ApiError: actual.ApiError,
    listCachedTorrents: vi.fn(),
    evictCachedTorrent: vi.fn(),
    getTorrentCacheSettings: vi.fn(),
    replaceTorrentCacheSettings: vi.fn(),
  }
})

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Server state behind the mocked API, so a remount reads what was saved.
let savedSettings: TorrentCacheSettings

function torrent(overrides: Partial<AdminTorrent> = {}): AdminTorrent {
  return {
    id: 't-1',
    infoHash: 'a1'.repeat(20),
    name: 'Big Buck Bunny',
    totalSize: 3 * 1024 ** 3,
    fileCount: 2,
    status: 'ready',
    verified: 'full',
    holders: 0,
    lastAccessedAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    sourceDownloader: { id: 'd-1', name: 'Home NAS' },
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Component = (Route as unknown as { component: React.ComponentType }).component
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Component />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

function entitled(enabled: boolean) {
  vi.mocked(useEntitlement).mockReturnValue({
    bound: enabled,
    active: enabled,
    edition: enabled ? 'pro' : 'community',
    licenseId: enabled ? 'license-1' : null,
    cloudDashboardUrl: null,
    hasFeature: (feature) => enabled && feature === 'torrent_cache',
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useEntitlement>)
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  search = {}
  entitled(true)
  savedSettings = { retentionDays: 30, capacityBytes: null }
  vi.mocked(getTorrentCacheSettings).mockImplementation(async () => savedSettings)
  vi.mocked(replaceTorrentCacheSettings).mockImplementation(async (input) => {
    savedSettings = input
    return input
  })
  vi.mocked(listCachedTorrents).mockResolvedValue({ items: [], nextPageToken: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Admin Torrents page', () => {
  it('saves retention and capacity and shows them after a reload [spec: torrent-cache/admin-settings]', async () => {
    const user = userEvent.setup()
    const first = renderPage()

    const summary = await screen.findByTestId('torrent-cache-settings-summary')
    expect(summary.textContent).toContain('"days":30')
    expect(summary.textContent).toContain('admin.torrents.settings.noCapacity')

    await user.click(screen.getByRole('button', { name: 'admin.torrents.settings.open' }))
    const retention = await screen.findByLabelText(/admin.torrents.settings.retention/)
    await user.clear(retention)
    await user.type(retention, '7')
    await user.click(screen.getByRole('switch'))
    await user.type(screen.getByLabelText(/admin.torrents.settings.capacity$/), '2')
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(replaceTorrentCacheSettings).toHaveBeenCalledWith({ retentionDays: 7, capacityBytes: 2 * 1024 ** 4 }),
    )

    // Reload: a fresh mount reads the saved settings back from the server.
    first.unmount()
    renderPage()
    const reloaded = await screen.findByTestId('torrent-cache-settings-summary')
    expect(reloaded.textContent).toContain('"days":7')
    expect(reloaded.textContent).toContain('2.0 TB')
  })

  it('lists torrents with holders, status and verification, and pages with the shared cursor', async () => {
    const user = userEvent.setup()
    vi.mocked(listCachedTorrents)
      .mockResolvedValueOnce({
        items: [torrent(), torrent({ id: 't-2', name: 'Sintel', holders: 3, verified: 'sampled' })],
        nextPageToken: 'next-token',
      })
      .mockResolvedValueOnce({
        items: [torrent({ id: 't-3', name: 'Tears of Steel', status: 'verifying', verified: null })],
        nextPageToken: null,
      })
    renderPage()

    const row = await screen.findByTestId('torrent-row-t-2')
    expect(within(row).getByText('Sintel')).toBeTruthy()
    expect(within(row).getByText('3')).toBeTruthy()
    expect(within(row).getByText('admin.torrents.status.ready')).toBeTruthy()
    expect(within(row).getByText('admin.torrents.verified.sampled')).toBeTruthy()
    expect(
      within(row)
        .getByRole('button', { name: /admin.torrents.evict.action/ })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(listCachedTorrents).toHaveBeenLastCalledWith({ pageToken: undefined, pageSize: 20 })

    await user.click(screen.getByRole('button', { name: 'common.nextPage' }))
    const next = await screen.findByTestId('torrent-row-t-3')
    expect(within(next).getByText('admin.torrents.verified.none')).toBeTruthy()
    expect(listCachedTorrents).toHaveBeenLastCalledWith({ pageToken: 'next-token', pageSize: 20 })
  })

  it('evicts an unheld torrent after confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(listCachedTorrents).mockResolvedValue({ items: [torrent()], nextPageToken: null })
    vi.mocked(evictCachedTorrent).mockResolvedValue(undefined)
    renderPage()

    await user.click(await screen.findByRole('button', { name: /admin.torrents.evict.action/ }))
    await user.click(await screen.findByRole('button', { name: 'admin.torrents.evict.confirm' }))

    await waitFor(() => expect(evictCachedTorrent).toHaveBeenCalledWith('t-1'))
  })

  it('shows the empty state and a retryable load error', async () => {
    renderPage()
    expect(await screen.findByText('admin.torrents.emptyTitle')).toBeTruthy()
    cleanup()

    vi.mocked(listCachedTorrents).mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByRole('button', { name: 'common.retry' })).toBeTruthy()
  })

  it('shows the locked state without the torrent_cache entitlement', async () => {
    entitled(false)
    renderPage()

    expect(await screen.findByText('admin.torrents.upgradeTitle')).toBeTruthy()
    expect(listCachedTorrents).not.toHaveBeenCalled()
    expect(getTorrentCacheSettings).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'admin.torrents.settings.open' })).toBeNull()
  })
})
