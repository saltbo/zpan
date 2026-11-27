import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, listTrash } from '@/lib/api'
import { TrashPage } from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/hooks/useServerEvents', () => ({ useServerEventSubscription: vi.fn() }))

vi.mock('@/components/layout/page-header', () => ({
  PageHeader: () => null,
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listTrash: vi.fn(),
  purgeTrashObject: vi.fn(),
  restoreObject: vi.fn(),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TrashPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Trash page load failure', () => {
  it('shows an inline alert with retry instead of the empty trash, and retry loads the list [spec: load-errors/trash-list]', async () => {
    vi.mocked(listTrash)
      .mockRejectedValueOnce(
        new ApiError(503, { error: { code: 503, message: 'Trash is unavailable', status: 'UNAVAILABLE' } }),
      )
      .mockResolvedValueOnce({ items: [], nextPageToken: null } as never)
    renderPage()

    expect(await screen.findByText('Trash is unavailable')).toBeTruthy()
    expect(screen.getByText('common.loadError.title')).toBeTruthy()
    expect(screen.queryByText('trash.placeholder')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))

    expect(await screen.findByText('trash.placeholder')).toBeTruthy()
    expect(screen.queryByText('common.loadError.title')).toBeNull()
    expect(listTrash).toHaveBeenCalledTimes(2)
  })
})
