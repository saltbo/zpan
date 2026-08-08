import { toDownloadTaskListItem } from '@shared/download-task'
import type { DownloadTask } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDownloadTask, listDownloadTasks } from '@/lib/api'
import { DownloadsPage } from './index'

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

vi.mock('@/lib/api', () => ({
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
