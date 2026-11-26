import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, listObjectsByPath } from '@/lib/api'
import { FileManager } from './file-manager'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/hooks/useServerEvents', () => ({ useServerEventSubscription: vi.fn() }))

vi.mock('@/hooks/use-site-config', () => ({ useSiteConfig: () => ({ data: undefined }) }))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({ isLoading: false, hasFeature: () => false }),
}))

vi.mock('@/components/music/music-player-provider', () => ({ useMusicPlayer: () => ({}) }))

vi.mock('@/components/upload/upload-dropzone', () => ({
  UploadDropzone: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./dnd-wrapper', () => ({
  DndWrapper: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./file-manager-dialogs', () => ({ FileManagerDialogs: () => null }))

vi.mock('@/components/layout/page-header', () => ({ PageHeader: () => null }))

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listObjectsByPath: vi.fn(),
  listMediaLibraries: vi.fn().mockResolvedValue([]),
}))

function renderFileManager() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <FileManager />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FileManager load failure', () => {
  it('shows an inline alert with retry instead of the empty folder, and retry loads the list [spec: load-errors/files-list]', async () => {
    vi.mocked(listObjectsByPath)
      .mockRejectedValueOnce(
        new ApiError(500, { error: { code: 500, message: 'Something went wrong on our side', status: 'INTERNAL' } }),
      )
      .mockResolvedValueOnce({ items: [], nextPageToken: null } as never)
    renderFileManager()

    expect(await screen.findByText('Something went wrong on our side')).toBeTruthy()
    expect(screen.getByText('common.loadError.title')).toBeTruthy()
    expect(screen.queryByText('files.emptyState')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))

    expect(await screen.findByText('files.emptyState')).toBeTruthy()
    expect(screen.queryByText('common.loadError.title')).toBeNull()
    expect(listObjectsByPath).toHaveBeenCalledTimes(2)
  })
})
