import { toDownloadTaskListItem } from '@shared/download-task'
import type { DownloadTask } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createDownloadTask, getDownloadTask, listDownloadTasks } from '@/lib/api'
import { routerSearch } from '@/test/router-search'
import { DownloadsPage, downloadsSearchSchema } from './index'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { routerSearch } = await import('@/test/router-search')
  return {
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useNavigate: routerSearch.useNavigate,
    useSearch: routerSearch.useSearch,
  }
})

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class TestIntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds = []
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/components/files/hooks/use-files-query', () => ({
  useFilesQuery: () => ({ data: { items: [] }, isLoading: false }),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/lib/api')>()).ApiError,
  createDownloadTask: vi.fn(),
  getDownloadTask: vi.fn(),
  listDownloadTaskEvents: vi.fn(),
  listDownloadTasks: vi.fn(),
  runDownloadTaskAction: vi.fn(),
}))

function task(id: string, name: string): DownloadTask {
  return {
    id,
    orgId: 'org-1',
    createdBy: 'user-1',
    spec: {
      source: { type: 'http', uri: `https://example.com/${id}.zip` },
      destination: { folder: '', name },
      labels: { category: null, tags: [] },
    },
    status: {
      state: 'downloading',
      attempt: 1,
      assignment: null,
      progress: {
        download: { bytes: 10, totalBytes: 100, bytesPerSecond: 5 },
        upload: { bytes: 0, totalBytes: 100, bytesPerSecond: 0 },
      },
      billing: { state: 'none', authorizedBytes: 0, chargedBytes: 0, chargedCredits: 0 },
      output: null,
      runtime: null,
      error: { message: `${id} detail` },
      resolveStartedAt: null,
      resolveCompletedAt: null,
      downloadCompletedAt: null,
      ingestStartedAt: null,
      ingestCompletedAt: null,
      seedingStartedAt: null,
      seedingStoppedAt: null,
      startedAt: '2026-07-27T12:00:00.000Z',
      finishedAt: null,
      updatedAt: '2026-07-27T12:00:00.000Z',
    },
    createdAt: '2026-07-27T12:00:00.000Z',
  }
}

function renderDownloadsPage(onRender: () => void) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Profiler id="downloads-page" onRender={onRender}>
        <DownloadsPage />
      </Profiler>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  routerSearch.reset()
})

describe('DownloadsPage task selection', () => {
  it('loads exactly one detail record for each selected row without a request loop', async () => {
    const first = task('task-a', 'Task A')
    const second = task('task-b', 'Task B')
    vi.mocked(listDownloadTasks).mockResolvedValue({
      items: [toDownloadTaskListItem(first), toDownloadTaskListItem(second)],
      nextPageToken: null,
    })
    vi.mocked(getDownloadTask).mockImplementation(async (id) => {
      if (id === first.id) return first
      if (id === second.id) return second
      throw new Error(`Unexpected task id: ${id}`)
    })
    let renderCount = 0

    renderDownloadsPage(() => {
      renderCount += 1
    })

    await waitFor(() => expect(getDownloadTask).toHaveBeenCalledTimes(1))
    expect(getDownloadTask).toHaveBeenLastCalledWith(first.id)
    await screen.findByText('task-a detail')

    fireEvent.click(screen.getByText('Task B'))
    await waitFor(() => expect(getDownloadTask).toHaveBeenCalledTimes(2))
    expect(getDownloadTask).toHaveBeenLastCalledWith(second.id)
    await screen.findByText('task-b detail')
    expect(screen.queryByText('task-a detail')).toBeNull()

    fireEvent.click(screen.getByText('Task A'))
    await waitFor(() => expect(getDownloadTask).toHaveBeenCalledTimes(3))
    expect(getDownloadTask).toHaveBeenLastCalledWith(first.id)
    await screen.findByText('task-a detail')
    expect(screen.queryByText('task-b detail')).toBeNull()

    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(getDownloadTask).toHaveBeenCalledTimes(3)
    expect(renderCount).toBeLessThan(30)
  })

  it('shows the requester and executing device in task details', async () => {
    const attributed = task('task-attributed', 'Attributed task')
    attributed.requestedBy = {
      type: 'agent',
      ref: 'agent-1',
      issuer: 'https://realm.example.com',
      name: 'Media Agent',
      image: null,
      resolved: true,
    }
    attributed.status.assignment = {
      downloaderId: 'downloader-1',
      assignedAt: '2026-07-27T12:00:00.000Z',
      executor: {
        type: 'device',
        ref: 'downloader-1',
        issuer: null,
        name: 'Device · living-room-mac',
        image: null,
        resolved: true,
      },
    }
    vi.mocked(listDownloadTasks).mockResolvedValue({
      items: [toDownloadTaskListItem(attributed)],
      nextPageToken: null,
    })
    vi.mocked(getDownloadTask).mockResolvedValue(attributed)

    renderDownloadsPage(() => undefined)

    expect(await screen.findByText('Media Agent')).toBeTruthy()
    expect(screen.getByText('Device · living-room-mac')).toBeTruthy()
    expect(screen.getByText('downloads.detail.requestedBy')).toBeTruthy()
    expect(screen.getByText('downloads.detail.executingDevice')).toBeTruthy()
  })
})

describe('DownloadsPage list state in the URL', () => {
  it('restores filters from the link and writes changes back [spec: list-state/downloads]', async () => {
    vi.mocked(listDownloadTasks).mockResolvedValue({ items: [], nextPageToken: null })
    routerSearch.reset(downloadsSearchSchema.parse({ status: 'failed', category: 'movies', tag: '4k' }))

    renderDownloadsPage(() => {})

    await waitFor(() =>
      expect(listDownloadTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', category: 'movies', tag: '4k' }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'downloads.filters' }))
    const categoryInput = (await screen.findByLabelText('downloads.category')) as HTMLInputElement
    expect(categoryInput.value).toBe('movies')

    fireEvent.change(categoryInput, { target: { value: 'music' } })
    expect(routerSearch.search).toEqual({ status: 'failed', category: 'music', tag: '4k' })
    expect(routerSearch.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }))
    await waitFor(() =>
      expect(listDownloadTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', category: 'music', tag: '4k' }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))
    expect(routerSearch.search).toEqual({})
    expect(routerSearch.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ replace: false }))
  })
})

describe('DownloadsPage create task field errors', () => {
  it('shows an invalid link under the link field and does not submit [spec: form-errors/download-task]', async () => {
    vi.mocked(listDownloadTasks).mockResolvedValue({ items: [], nextPageToken: null } as never)
    renderDownloadsPage(() => {})

    fireEvent.click(screen.getByRole('button', { name: 'downloads.create' }))
    const uri = await screen.findByLabelText('downloads.uri')
    fireEvent.change(uri, { target: { value: 'ftp://example.com/file.zip' } })
    fireEvent.click(screen.getByRole('button', { name: 'downloads.start' }))

    const error = await screen.findByText('downloads.uriUrlInvalid')
    expect(uri.getAttribute('aria-invalid')).toBe('true')
    expect(uri.getAttribute('aria-describedby')).toBe(error.id)
    expect(createDownloadTask).not.toHaveBeenCalled()
  })

  it('shows a link the server rejects under the link field [spec: form-errors/download-task]', async () => {
    vi.mocked(listDownloadTasks).mockResolvedValue({ items: [], nextPageToken: null } as never)
    vi.mocked(createDownloadTask).mockRejectedValue(
      new ApiError(400, {
        error: {
          code: 400,
          message: '链接须为公网 http(s) 地址',
          status: 'INVALID_ARGUMENT',
          details: [
            {
              reason: 'INVALID_ARGUMENT',
              domain: 'zpan.dev',
              metadata: { field: 'source.uri' },
            },
          ],
        },
      }),
    )
    renderDownloadsPage(() => {})

    fireEvent.click(screen.getByRole('button', { name: 'downloads.create' }))
    const uri = await screen.findByLabelText('downloads.uri')
    fireEvent.change(uri, { target: { value: 'http://127.0.0.1/a.zip' } })
    fireEvent.click(screen.getByRole('button', { name: 'downloads.start' }))

    const error = await screen.findByText('链接须为公网 http(s) 地址')
    expect(uri.getAttribute('aria-invalid')).toBe('true')
    expect(uri.getAttribute('aria-describedby')).toBe(error.id)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a rejected task above the submit button', async () => {
    vi.mocked(listDownloadTasks).mockResolvedValue({ items: [], nextPageToken: null } as never)
    vi.mocked(createDownloadTask).mockRejectedValue(new Error('URL must be a public http(s) address'))
    renderDownloadsPage(() => {})

    fireEvent.click(screen.getByRole('button', { name: 'downloads.create' }))
    fireEvent.change(await screen.findByLabelText('downloads.uri'), {
      target: { value: ' https://example.com/file.zip ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'downloads.start' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('URL must be a public http(s) address')
    expect(vi.mocked(createDownloadTask).mock.calls[0][0]).toEqual({
      source: { type: 'http', uri: 'https://example.com/file.zip' },
      targetFolder: '',
      name: undefined,
      category: undefined,
      tags: [],
    })
  })
})
