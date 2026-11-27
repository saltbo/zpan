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
