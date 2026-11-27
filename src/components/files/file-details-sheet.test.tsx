import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getObjectCreator, getObjectTorrent } from '@/lib/api'
import { NameConflictDialog } from './dialogs/name-conflict-dialog'
import { FileDetailsSheet } from './file-details-sheet'
import type { MediaLibraryActions } from './types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  }),
}))

vi.mock('./file-icon', () => ({ FileIcon: () => <span data-testid="file-icon" /> }))
vi.mock('@/lib/api', () => ({
  getObjectCreator: vi.fn(),
  getObjectTorrent: vi.fn(),
}))

const item: StorageObject = {
  id: 'file-1',
  orgId: 'org-1',
  alias: 'alias-1',
  name: 'report.pdf',
  type: 'application/pdf',
  size: 1024,
  dirtype: DirType.FILE,
  parent: 'Reports',
  object: 'object-key',
  storageId: 'storage-1',
  status: 'active',
  trashedAt: null,
  createdBy: {
    type: 'agent',
    ref: 'agent-1',
    issuer: 'https://realm.example.com',
  },
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-02T12:00:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FileDetailsSheet', () => {
  it('loads the creator profile and shows file metadata', async () => {
    vi.mocked(getObjectCreator).mockResolvedValue({
      ...item.createdBy!,
      name: 'Report Agent',
      image: null,
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <FileDetailsSheet item={item} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('report.pdf')).toBeTruthy()
    expect(await screen.findByText('Report Agent')).toBeTruthy()
    expect(screen.getByText('/Reports')).toBeTruthy()
    expect(screen.getByText('1.0 KB')).toBeTruthy()
  })

  it('does not render without a selected item', () => {
    const { container } = render(<FileDetailsSheet item={null} onOpenChange={vi.fn()} />)

    expect(container.firstChild).toBeNull()
  })

  it('shows the media library status and index path of a folder', () => {
    vi.mocked(getObjectCreator).mockResolvedValue({ ...item.createdBy!, name: 'Report Agent', image: null })
    const folder: StorageObject = { ...item, id: 'folder-1', name: 'Movies', dirtype: DirType.USER_FOLDER, parent: '' }
    const lastScannedAt = '2026-08-03T12:00:00.000Z'
    const actions = (overrides: Partial<MediaLibraryActions>): MediaLibraryActions => ({
      locked: false,
      libraryFor: () => undefined,
      onSet: vi.fn(),
      onRemove: vi.fn(),
      onRescan: vi.fn(),
      ...overrides,
    })
    const renderSheet = (mediaLibrary: MediaLibraryActions) =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <FileDetailsSheet item={folder} onOpenChange={vi.fn()} mediaLibrary={mediaLibrary} />
        </QueryClientProvider>,
      )

    renderSheet(
      actions({
        libraryFor: () =>
          ({ id: 'lib-1', folderPath: 'Movies', scanning: false, lastScannedAt }) as ReturnType<
            MediaLibraryActions['libraryFor']
          >,
      }),
    )
    expect(
      screen.getByText(`mediaLibrary.lastScanned:{"date":"${new Date(lastScannedAt).toLocaleDateString()}"}`),
    ).toBeTruthy()
    expect(screen.getByText('/Movies/library.json')).toBeTruthy()
    cleanup()

    renderSheet(actions({}))
    expect(screen.getByText('mediaLibrary.none')).toBeTruthy()
    cleanup()

    renderSheet(actions({ locked: true }))
    expect(screen.queryByText('mediaLibrary.title')).toBeNull()
    expect(screen.queryByText('mediaLibrary.indexFile')).toBeNull()
    cleanup()

    renderSheet(
      actions({
        locked: true,
        libraryFor: () =>
          ({ id: 'lib-1', folderPath: 'Movies', scanning: false, lastScannedAt: null }) as ReturnType<
            MediaLibraryActions['libraryFor']
          >,
      }),
    )
    expect(screen.getByText('mediaLibrary.notScanned')).toBeTruthy()
    expect(screen.getByText('/Movies/library.json')).toBeTruthy()
  })

  it('marks a transferred file as cached with its torrent and verification, and keeps its content from being replaced [spec: torrent-cache/drive-cached-mark]', async () => {
    vi.mocked(getObjectCreator).mockResolvedValue({ ...item.createdBy!, name: 'Report Agent', image: null })
    const infoHash = 'ab'.repeat(20)
    vi.mocked(getObjectTorrent).mockResolvedValue({
      infoHash,
      name: 'Big Buck Bunny',
      status: 'ready',
      verified: 'full',
    })
    const cached: StorageObject = { ...item, id: 'cached-1', name: 'movie.mkv', object: `bt/${infoHash}/0` }

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FileDetailsSheet item={cached} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('files.torrent.mark')).toBeTruthy()
    expect(await screen.findByText('Big Buck Bunny')).toBeTruthy()
    expect(screen.getByText(infoHash)).toBeTruthy()
    expect(screen.getByText('files.torrent.status.ready')).toBeTruthy()
    expect(screen.getByText('files.torrent.verified.full')).toBeTruthy()
    expect(screen.getByText('files.torrent.readOnly')).toBeTruthy()
    expect(getObjectTorrent).toHaveBeenCalledWith('cached-1')
    cleanup()

    // Uploading or moving a same-named file onto it cannot replace it.
    render(
      <NameConflictDialog
        request={{ kind: 'file', name: 'movie.mkv', readOnly: true }}
        applyToAll={false}
        onApplyToAllChange={vi.fn()}
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect((screen.getByRole('button', { name: 'files.conflictReplace' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'files.conflictKeepBoth' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('files.conflictReadOnlyHint:{"name":"movie.mkv"}')).toBeTruthy()
  })

  it('shows an unverified torrent and a torrent that cannot be loaded', async () => {
    vi.mocked(getObjectCreator).mockResolvedValue({ ...item.createdBy!, name: 'Report Agent', image: null })
    const renderCached = (id: string) =>
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <FileDetailsSheet item={{ ...item, id, object: `bt/${'cd'.repeat(20)}/1` }} onOpenChange={vi.fn()} />
        </QueryClientProvider>,
      )

    vi.mocked(getObjectTorrent).mockResolvedValueOnce({
      infoHash: 'cd'.repeat(20),
      name: 'Sintel',
      status: 'verifying',
      verified: null,
    })
    renderCached('cached-2')
    expect(await screen.findByText('files.torrent.status.verifying')).toBeTruthy()
    expect(screen.getByText('files.torrent.verified.none')).toBeTruthy()
    cleanup()

    vi.mocked(getObjectTorrent).mockRejectedValueOnce(new Error('Not found'))
    renderCached('cached-3')
    expect(await screen.findByText('files.torrent.loadFailed')).toBeTruthy()
    expect(screen.getByText('files.torrent.mark')).toBeTruthy()
  })

  it('shows no torrent mark for an ordinary file', () => {
    vi.mocked(getObjectCreator).mockResolvedValue({ ...item.createdBy!, name: 'Report Agent', image: null })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FileDetailsSheet item={item} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByText('files.torrent.mark')).toBeNull()
    expect(screen.queryByText('files.torrent.readOnly')).toBeNull()
    expect(getObjectTorrent).not.toHaveBeenCalled()
  })
})
