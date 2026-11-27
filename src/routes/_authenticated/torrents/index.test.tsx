import type { WorkspaceTorrent, WorkspaceTorrentDetail } from '@shared/schemas'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useWorkspaceRoleAtLeast } from '@/hooks/use-workspace-role'
import { useEntitlement } from '@/hooks/useEntitlement'
import {
  ApiError,
  createWorkspaceTorrentFileLink,
  deleteWorkspaceTorrent,
  getWorkspaceTorrent,
  listObjectsByPath,
  listWorkspaceTorrents,
  saveWorkspaceTorrentToDrive,
} from '@/lib/api'
import { startDownload } from '@/lib/browser-navigation'
import { Route } from './index'

const navigate = vi.fn()
let search: { q?: string; id?: string } = {}

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
vi.mock('@/hooks/use-workspace-role', () => ({ useWorkspaceRoleAtLeast: vi.fn() }))
vi.mock('@/lib/browser-navigation', () => ({ startDownload: vi.fn() }))
vi.mock('@/hooks/useServerEvents', () => ({ useServerEventSubscription: vi.fn() }))
vi.mock('@/components/UpgradeHint', () => ({ UpgradeHint: () => <div>upgrade-hint</div> }))
vi.mock('@/components/preview/file-preview-dialog', () => ({
  FilePreviewDialog: ({ file }: { file: { name: string; downloadUrl: string } | null }) =>
    file ? <div data-testid="preview">{`${file.name} ${file.downloadUrl}`}</div> : null,
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ApiError: actual.ApiError,
    listWorkspaceTorrents: vi.fn(),
    getWorkspaceTorrent: vi.fn(),
    createWorkspaceTorrentFileLink: vi.fn(),
    deleteWorkspaceTorrent: vi.fn(),
    saveWorkspaceTorrentToDrive: vi.fn(),
    listObjectsByPath: vi.fn(),
  }
})

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function entry(overrides: Partial<WorkspaceTorrent> = {}): WorkspaceTorrent {
  return {
    id: 'e-1',
    infoHash: 'a1'.repeat(20),
    name: 'Big Buck Bunny',
    size: 3 * 1024 ** 3,
    fileCount: 2,
    status: 'ready',
    error: null,
    source: 'stremthru',
    sourceUri: 'magnet:?xt=urn:btih:a1',
    playable: true,
    taskId: null,
    lastPlayedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

const detail: WorkspaceTorrentDetail = {
  ...entry(),
  files: [
    { id: 'f-0', index: 0, path: 'Big Buck Bunny/bunny.mkv', size: 1024, mime: 'video/x-matroska' },
    { id: 'f-1', index: 1, path: 'Big Buck Bunny/bunny.srt', size: 10, mime: 'application/x-subrip' },
  ],
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
    hasFeature: (feature: string) => enabled && feature === 'torrents',
    isLoading: false,
  } as unknown as ReturnType<typeof useEntitlement>)
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  search = {}
  entitled(true)
  vi.mocked(useWorkspaceRoleAtLeast).mockReturnValue(true)
  vi.mocked(listWorkspaceTorrents).mockResolvedValue({
    items: [
      entry(),
      entry({
        id: 'e-2',
        name: 'Sintel',
        status: 'failed',
        error: 'tracker down',
        source: 'download',
        size: null,
        playable: false,
      }),
    ],
    nextPageToken: null,
  })
  vi.mocked(getWorkspaceTorrent).mockResolvedValue(detail)
  vi.mocked(listObjectsByPath).mockResolvedValue({
    items: [{ id: 'm-1', name: 'Movies', dirtype: 1 }],
    nextPageToken: null,
  } as unknown as Awaited<ReturnType<typeof listObjectsByPath>>)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Torrents page', () => {
  it('lists entries and opens one with its own files, play, download, Save to drive and Remove [spec: torrents/workspace-page]', async () => {
    const user = userEvent.setup()
    vi.mocked(createWorkspaceTorrentFileLink).mockResolvedValue({
      url: 'https://bucket/bunny.mkv',
      expiresAt: '2026-11-01T12:00:00.000Z',
    })
    vi.mocked(saveWorkspaceTorrentToDrive).mockResolvedValue({ files: [] })
    vi.mocked(deleteWorkspaceTorrent).mockResolvedValue(undefined)
    const view = renderPage()

    const ready = await screen.findByTestId('torrent-entry-e-1')
    expect(within(ready).getByText('Big Buck Bunny')).toBeTruthy()
    expect(within(ready).getByText('3.0 GB')).toBeTruthy()
    expect(within(ready).getByText('torrents.status.ready')).toBeTruthy()
    expect(within(ready).getByText('torrents.source.stremthru')).toBeTruthy()
    const failed = screen.getByTestId('torrent-entry-e-2')
    expect(within(failed).getByText('torrents.status.failed')).toBeTruthy()
    expect(within(failed).getByText('tracker down')).toBeTruthy()

    // Opening a row puts it in the URL; the sheet reads the selected entry back.
    await user.click(within(failed).getByText('torrents.source.download'))
    expect(navigate).toHaveBeenCalledTimes(1)
    // The name is the row's keyboard target.
    within(ready).getByRole('button', { name: 'Big Buck Bunny' }).focus()
    await user.keyboard('{Enter}')
    expect(navigate).toHaveBeenCalledTimes(2)
    const opened = navigate.mock.calls[1][0] as { search: (prev: object) => object }
    expect(opened.search({ q: 'x' })).toEqual({ q: 'x', id: 'e-1' })
    search = { id: 'e-1' }
    view.unmount()
    renderPage()
    expect(await screen.findByText('Big Buck Bunny/bunny.mkv')).toBeTruthy()
    expect(screen.getByText('Big Buck Bunny/bunny.srt')).toBeTruthy()
    expect(getWorkspaceTorrent).toHaveBeenCalledWith('e-1')

    await user.click(screen.getByRole('button', { name: 'torrents.sheet.play {"name":"bunny.mkv"}' }))
    expect(await screen.findByTestId('preview')).toBeTruthy()
    expect(createWorkspaceTorrentFileLink).toHaveBeenCalledWith('e-1', 'f-0')
    expect(screen.queryByRole('button', { name: 'torrents.sheet.play {"name":"bunny.srt"}' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'torrents.sheet.download {"name":"bunny.srt"}' }))
    // A download starts in this tab, so a popup blocker cannot drop it after the await.
    await waitFor(() => expect(startDownload).toHaveBeenCalledWith('https://bucket/bunny.mkv'))

    await user.click(screen.getByRole('button', { name: 'torrents.save.action' }))
    const picker = await screen.findByRole('dialog', { name: /torrents.save.title/ })
    await user.click(await within(picker).findByText('Movies'))
    await user.click(within(picker).getByRole('button', { name: 'torrents.save.confirm' }))
    await waitFor(() => expect(saveWorkspaceTorrentToDrive).toHaveBeenCalledWith('e-1', 'Movies'))

    await user.click(screen.getByRole('button', { name: 'torrents.remove.action' }))
    const confirm = await screen.findByRole('dialog', { name: /torrents.remove.title/ })
    await user.click(within(confirm).getByRole('button', { name: 'torrents.remove.confirm' }))
    await waitFor(() => expect(deleteWorkspaceTorrent).toHaveBeenCalledWith('e-1'))
  })

  it('searches by the text in the URL and shows the empty state', async () => {
    search = { q: 'nothing' }
    vi.mocked(listWorkspaceTorrents).mockResolvedValue({ items: [], nextPageToken: null })
    renderPage()

    expect(await screen.findByText('torrents.noMatchTitle')).toBeTruthy()
    expect(listWorkspaceTorrents).toHaveBeenCalledWith(expect.objectContaining({ search: 'nothing' }))
  })

  it('shows the locked state without the entitlement', async () => {
    entitled(false)
    renderPage()

    expect(await screen.findByText('upgrade-hint')).toBeTruthy()
    expect(listWorkspaceTorrents).not.toHaveBeenCalled()
  })

  it('keeps a rejected save or remove in its dialog', async () => {
    const user = userEvent.setup()
    search = { id: 'e-1' }
    vi.mocked(saveWorkspaceTorrentToDrive).mockRejectedValue(new Error('Quota exceeded'))
    vi.mocked(deleteWorkspaceTorrent).mockRejectedValue(new Error('Torrent not found'))
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'torrents.save.action' }))
    const picker = await screen.findByRole('dialog', { name: /torrents.save.title/ })
    await user.click(within(picker).getByRole('button', { name: 'torrents.save.confirm' }))
    expect((await within(picker).findByRole('alert')).textContent).toBe('Quota exceeded')
    expect(screen.getByRole('dialog', { name: /torrents.save.title/ })).toBeTruthy()
    await user.click(within(picker).getByRole('button', { name: 'common.cancel' }))

    await user.click(screen.getByRole('button', { name: 'torrents.remove.action' }))
    const confirm = await screen.findByRole('dialog', { name: /torrents.remove.title/ })
    expect(within(confirm).queryByRole('alert')).toBeNull()
    await user.click(within(confirm).getByRole('button', { name: 'torrents.remove.confirm' }))
    expect((await within(confirm).findByRole('alert')).textContent).toBe('Torrent not found')
  })

  it('offers a viewer play and download, without Save to drive or Remove', async () => {
    const user = userEvent.setup()
    vi.mocked(useWorkspaceRoleAtLeast).mockReturnValue(false)
    const view = renderPage()

    const row = await screen.findByTestId('torrent-entry-e-1')
    await user.click(within(row).getByRole('button', { name: /torrents.rowActions/ }))
    expect(await screen.findByRole('menuitem', { name: 'torrents.open' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'torrents.save.action' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'torrents.remove.action' })).toBeNull()
    expect(useWorkspaceRoleAtLeast).toHaveBeenCalledWith('editor')

    view.unmount()
    search = { id: 'e-1' }
    renderPage()
    expect(await screen.findByText('Big Buck Bunny/bunny.mkv')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'torrents.sheet.play {"name":"bunny.mkv"}' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'torrents.save.action' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'torrents.remove.action' })).toBeNull()
  })

  it('refreshes an open entry until it settles, and keeps it shown when a refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      search = { id: 'e-1' }
      vi.mocked(getWorkspaceTorrent)
        .mockResolvedValueOnce({ ...detail, status: 'downloading', playable: false, files: [] })
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(detail)
      renderPage()

      expect(await screen.findByText('torrents.sheet.noFiles')).toBeTruthy()
      await vi.advanceTimersByTimeAsync(5000)
      await waitFor(() => expect(getWorkspaceTorrent).toHaveBeenCalledTimes(2))
      // The failed refresh leaves what was loaded in place.
      expect(screen.getByText('torrents.sheet.noFiles')).toBeTruthy()
      await vi.advanceTimersByTimeAsync(5000)
      expect(await screen.findByText('Big Buck Bunny/bunny.mkv')).toBeTruthy()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(getWorkspaceTorrent).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the sheet when the entry behind the link is gone', async () => {
    search = { id: 'gone' }
    vi.mocked(getWorkspaceTorrent).mockRejectedValue(
      new ApiError(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Torrent not found' } }),
    )
    renderPage()

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    const closed = navigate.mock.calls.at(-1)?.[0] as { search: (prev: object) => object }
    expect(closed.search({ id: 'gone', q: 'x' })).toEqual({ q: 'x', id: undefined })
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })
})
