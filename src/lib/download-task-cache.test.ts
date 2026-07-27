import type { CursorPage, DownloadTask, DownloadTaskListItem } from '@shared/types'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDownloadTask } from '@/lib/api'
import {
  DOWNLOAD_TASKS_QUERY_KEY,
  matchesDownloadTaskQuery,
  removeDownloadTaskFromPages,
  syncDownloadTaskChange,
  updateDownloadTaskPages,
} from './download-task-cache'

vi.mock('@/lib/api', () => ({
  getDownloadTask: vi.fn(),
}))

function summary(
  id: string,
  state: DownloadTaskListItem['status']['state'] = 'downloading',
  category: string | null = 'movies',
  tags = ['linux'],
) {
  return {
    id,
    spec: {
      source: { type: 'http', uri: `https://example.com/${id}` },
      destination: { folder: 'Downloads', name: `${id}.bin` },
      labels: { category, tags },
    },
    status: {
      state,
      progress: {
        download: { bytes: 10, totalBytes: 100, bytesPerSecond: 2 },
        upload: { bytes: 0, totalBytes: 100, bytesPerSecond: 0 },
      },
      runtime: null,
    },
    createdAt: '2026-07-27T00:00:00.000Z',
  } satisfies DownloadTaskListItem
}

function detail(
  id: string,
  state: DownloadTaskListItem['status']['state'] = 'downloading',
  category: string | null = 'movies',
  tags = ['linux'],
) {
  const item = summary(id, state, category, tags)
  return {
    ...item,
    status: {
      ...item.status,
      attempt: 1,
      assignment: null,
      billing: { state: 'none', authorizedBytes: 0, chargedBytes: 0, chargedCredits: 0 },
      output: null,
      error: null,
      resolveStartedAt: null,
      resolveCompletedAt: null,
      downloadCompletedAt: null,
      ingestStartedAt: null,
      ingestCompletedAt: null,
      seedingStartedAt: null,
      seedingStoppedAt: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: '2026-07-27T00:00:00.000Z',
    },
  } as DownloadTask
}

function pages(...items: DownloadTaskListItem[]) {
  return {
    pages: [{ items, nextPageToken: null }] satisfies CursorPage<DownloadTaskListItem>[],
    pageParams: [undefined],
  }
}

describe('download task cache synchronization', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('matches all supported list filters', () => {
    const task = summary('task-1')

    expect(matchesDownloadTaskQuery(task, [...DOWNLOAD_TASKS_QUERY_KEY, 'downloading', 'movies', 'linux'])).toBe(true)
    expect(matchesDownloadTaskQuery(task, [...DOWNLOAD_TASKS_QUERY_KEY, 'completed', 'movies', 'linux'])).toBe(false)
    expect(matchesDownloadTaskQuery(task, [...DOWNLOAD_TASKS_QUERY_KEY, 'downloading', 'shows', 'linux'])).toBe(false)
    expect(matchesDownloadTaskQuery(task, [...DOWNLOAD_TASKS_QUERY_KEY, 'downloading', 'movies', 'bsd'])).toBe(false)
  })

  it('patches an existing task and removes it when it leaves a filtered result', () => {
    const original = pages(summary('task-1'))
    const updated = summary('task-1', 'completed')

    expect(updateDownloadTaskPages(original, updated, DOWNLOAD_TASKS_QUERY_KEY)?.pages[0]?.items).toEqual([updated])
    expect(
      updateDownloadTaskPages(original, updated, [...DOWNLOAD_TASKS_QUERY_KEY, 'downloading'])?.pages[0]?.items,
    ).toEqual([])
    expect(removeDownloadTaskFromPages(original, 'task-1')?.pages[0]?.items).toEqual([])
  })

  it('updates only the changed list row and its detail cache from one detail request', async () => {
    const listKey = [...DOWNLOAD_TASKS_QUERY_KEY, '', '', '']
    const detailKey = ['download-task', 'task-1']
    queryClient.setQueryData(listKey, pages(summary('task-1'), summary('task-2')))
    queryClient.setQueryData(detailKey, { id: 'task-1' })
    const updatedDetail = detail('task-1', 'uploading')
    const updated = summary('task-1', 'uploading')
    vi.mocked(getDownloadTask).mockResolvedValue(updatedDetail)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const reset = vi.spyOn(queryClient, 'resetQueries')

    await syncDownloadTaskChange(queryClient, {
      resourceType: 'download_task',
      resourceId: 'task-1',
      changeType: 'upsert',
      action: 'updated',
    })

    expect(queryClient.getQueryData<ReturnType<typeof pages>>(listKey)?.pages[0]?.items).toEqual([
      updated,
      summary('task-2'),
    ])
    expect(reset).not.toHaveBeenCalled()
    expect(getDownloadTask).toHaveBeenCalledWith('task-1')
    expect(queryClient.getQueryData(detailKey)).toEqual(updatedDetail)
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ['download-task-events', 'task-1'],
      exact: true,
    })
  })

  it('removes deleted task data from every related cache', async () => {
    const listKey = [...DOWNLOAD_TASKS_QUERY_KEY, '', '', '']
    queryClient.setQueryData(listKey, pages(summary('task-1'), summary('task-2')))
    queryClient.setQueryData(['download-task', 'task-1'], { id: 'task-1' })
    queryClient.setQueryData(['download-task-events', 'task-1'], { items: [] })

    await syncDownloadTaskChange(queryClient, {
      resourceType: 'download_task',
      resourceId: 'task-1',
      changeType: 'delete',
      action: 'deleted',
    })

    expect(queryClient.getQueryData<ReturnType<typeof pages>>(listKey)?.pages[0]?.items).toEqual([summary('task-2')])
    expect(queryClient.getQueryData(['download-task', 'task-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['download-task-events', 'task-1'])).toBeUndefined()
  })

  it('treats an upsert whose authoritative detail is gone as a deletion', async () => {
    const listKey = [...DOWNLOAD_TASKS_QUERY_KEY, '', '', '']
    queryClient.setQueryData(listKey, pages(summary('task-1')))
    vi.mocked(getDownloadTask).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))

    await syncDownloadTaskChange(queryClient, {
      resourceType: 'download_task',
      resourceId: 'task-1',
      changeType: 'upsert',
      action: 'updated',
    })

    expect(queryClient.getQueryData<ReturnType<typeof pages>>(listKey)?.pages[0]?.items).toEqual([])
  })

  it('resets a matching status query when a changed task enters the filter', async () => {
    const filteredKey = [...DOWNLOAD_TASKS_QUERY_KEY, 'downloading', '', '']
    queryClient.setQueryData(filteredKey, pages(summary('task-2')))
    vi.mocked(getDownloadTask).mockResolvedValue(detail('task-1'))
    const reset = vi.spyOn(queryClient, 'resetQueries')

    await syncDownloadTaskChange(queryClient, {
      resourceType: 'download_task',
      resourceId: 'task-1',
      changeType: 'upsert',
      action: 'status_changed',
    })

    expect(reset).toHaveBeenCalledWith({ queryKey: filteredKey, exact: true })
  })

  it('does not reset a filtered page for a routine update to an unloaded task', async () => {
    const filteredKey = [...DOWNLOAD_TASKS_QUERY_KEY, '', 'movies', '']
    queryClient.setQueryData(filteredKey, pages(summary('task-2')))
    vi.mocked(getDownloadTask).mockResolvedValue(detail('task-1'))
    const reset = vi.spyOn(queryClient, 'resetQueries')

    await syncDownloadTaskChange(queryClient, {
      resourceType: 'download_task',
      resourceId: 'task-1',
      changeType: 'upsert',
      action: 'updated',
    })

    expect(reset).not.toHaveBeenCalled()
  })

  it('resets matching lists when a task is created', async () => {
    const listKey = [...DOWNLOAD_TASKS_QUERY_KEY, '', '', '']
    queryClient.setQueryData(listKey, pages(summary('task-2')))
    vi.mocked(getDownloadTask).mockResolvedValue(detail('task-1'))
    const reset = vi.spyOn(queryClient, 'resetQueries')

    await syncDownloadTaskChange(queryClient, {
      resourceType: 'download_task',
      resourceId: 'task-1',
      changeType: 'upsert',
      action: 'created',
    })

    expect(reset).toHaveBeenCalledWith({ queryKey: listKey, exact: true })
  })

  it('resets all task lists for a wildcard change', async () => {
    const reset = vi.spyOn(queryClient, 'resetQueries')

    await syncDownloadTaskChange(queryClient, {
      resourceType: 'download_task',
      resourceId: '*',
      changeType: 'upsert',
      action: null,
    })

    expect(reset).toHaveBeenCalledWith({ queryKey: DOWNLOAD_TASKS_QUERY_KEY })
  })
})
