import type { BackgroundJob } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listBackgroundJobs } from '@/lib/api'
import { routerSearch } from '@/test/router-search'
import { TasksPage, tasksSearchSchema } from './index'

vi.mock('@tanstack/react-router', async () => {
  const { routerSearch } = await import('@/test/router-search')
  return {
    createFileRoute: () => (options: unknown) => options,
    useNavigate: routerSearch.useNavigate,
    useSearch: routerSearch.useSearch,
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/hooks/useInfiniteScroll', () => ({ useInfiniteScroll: () => ({ current: null }) }))

vi.mock('@/lib/api', () => ({
  cancelBackgroundJob: vi.fn(),
  listBackgroundJobs: vi.fn(),
  retryBackgroundJob: vi.fn(),
}))

function renderTasksPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TasksPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  routerSearch.reset()
})

describe('TasksPage list state in the URL', () => {
  it('restores the filter from the link and writes changes back [spec: list-state/tasks]', async () => {
    vi.mocked(listBackgroundJobs).mockResolvedValue({ items: [], nextPageToken: null })
    routerSearch.reset(tasksSearchSchema.parse({ filter: 'failed' }))

    renderTasksPage()

    await waitFor(() => expect(listBackgroundJobs).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' })))

    fireEvent.click(await screen.findByRole('button', { name: 'tasks.filter.completed' }))
    expect(routerSearch.search).toEqual({ filter: 'completed' })
    await waitFor(() =>
      expect(listBackgroundJobs).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' })),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'tasks.filter.active' }))
    expect(routerSearch.search).toEqual({})
  })
})

function job(id: string, status: BackgroundJob['status']): BackgroundJob {
  return {
    id,
    orgId: 'org-1',
    userId: 'user-1',
    type: 'archive_compress',
    status,
    targetFolder: null,
    targetPath: null,
    metadata: null,
    progress: { inputBytes: 0, outputBytes: 0, processedBytes: 0, fileCount: 0, currentFilename: null },
    errorMessage: null,
    resultMetadata: null,
    retryable: false,
    cancelable: false,
    retriedFromJobId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  }
}

describe('TasksPage while a new filter loads', () => {
  it('keeps the filter bar and the previous rows, dimmed, until the new rows arrive [spec: list-state/refetch-keeps-layout]', async () => {
    let resolveCompleted: (page: { items: BackgroundJob[]; nextPageToken: null }) => void = () => {}
    vi.mocked(listBackgroundJobs).mockImplementation(({ status } = {}) =>
      status === 'completed'
        ? new Promise((resolve) => {
            resolveCompleted = resolve
          })
        : Promise.resolve({
            items: [job('job-running', 'running'), job('job-done', 'completed')],
            nextPageToken: null,
          }),
    )

    renderTasksPage()

    expect(await screen.findByText('job-running')).toBeTruthy()
    // The active filter lists only queued and running tasks.
    expect(screen.queryByText('job-done')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'tasks.filter.completed' }))

    await waitFor(() =>
      expect(listBackgroundJobs).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' })),
    )
    expect(screen.queryByText('common.loading')).toBeNull()
    expect(screen.getByRole('button', { name: 'tasks.filter.completed' })).toBeTruthy()
    expect(screen.getByText('job-running').closest('tbody')?.getAttribute('aria-busy')).toBe('true')

    resolveCompleted({ items: [job('job-finished', 'completed')], nextPageToken: null })

    expect(await screen.findByText('job-finished')).toBeTruthy()
    expect(screen.queryByText('job-running')).toBeNull()
    expect(screen.getByText('job-finished').closest('tbody')?.getAttribute('aria-busy')).toBe('false')
  })

  it('shows the loading state on the first load', () => {
    vi.mocked(listBackgroundJobs).mockReturnValue(new Promise(() => {}))

    renderTasksPage()

    expect(screen.getByText('common.loading')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'tasks.filter.completed' })).toBeNull()
  })
})
