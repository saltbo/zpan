import { toDownloadTaskListItem } from '@shared/download-task'
import type { CursorPage, DownloadTaskListItem } from '@shared/types'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { getDownloadTask } from '@/lib/api'

export const DOWNLOAD_TASKS_QUERY_KEY = ['download-tasks'] as const

export type DownloadTaskChange = {
  resourceType: 'download_task'
  resourceId: string
  changeType: 'upsert' | 'delete'
  action: string | null
}

export type DownloadTaskPages = InfiniteData<CursorPage<DownloadTaskListItem>, string | undefined>

export function matchesDownloadTaskQuery(item: DownloadTaskListItem, queryKey: readonly unknown[]) {
  const status = typeof queryKey[1] === 'string' ? queryKey[1] : ''
  const category = typeof queryKey[2] === 'string' ? queryKey[2] : ''
  const tag = typeof queryKey[3] === 'string' ? queryKey[3] : ''
  return (
    (!status || item.status.state === status) &&
    (!category || item.spec.labels.category === category) &&
    (!tag || item.spec.labels.tags.includes(tag))
  )
}

export function updateDownloadTaskPages(
  data: DownloadTaskPages | undefined,
  item: DownloadTaskListItem,
  queryKey: readonly unknown[],
) {
  if (!data) return data
  const containsTask = data.pages.some((page) => page.items.some((task) => task.id === item.id))
  if (!containsTask) return data
  const matches = matchesDownloadTaskQuery(item, queryKey)
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: matches
        ? page.items.map((task) => (task.id === item.id ? item : task))
        : page.items.filter((task) => task.id !== item.id),
    })),
  }
}

export function removeDownloadTaskFromPages(data: DownloadTaskPages | undefined, taskId: string) {
  if (!data) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.id !== taskId),
    })),
  }
}

function removeDownloadTaskCaches(queryClient: QueryClient, taskId: string) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: DOWNLOAD_TASKS_QUERY_KEY })) {
    queryClient.setQueryData(query.queryKey, (data) =>
      removeDownloadTaskFromPages(data as DownloadTaskPages | undefined, taskId),
    )
  }
  queryClient.removeQueries({ queryKey: ['download-task', taskId], exact: true })
  queryClient.removeQueries({ queryKey: ['download-task-events', taskId], exact: true })
}

export async function syncDownloadTaskChange(queryClient: QueryClient, change: DownloadTaskChange) {
  if (change.resourceId === '*') {
    await queryClient.resetQueries({ queryKey: DOWNLOAD_TASKS_QUERY_KEY })
    return
  }

  if (change.changeType === 'delete') {
    removeDownloadTaskCaches(queryClient, change.resourceId)
    return
  }

  let item: DownloadTaskListItem
  try {
    const task = await queryClient.fetchQuery({
      queryKey: ['download-task', change.resourceId],
      queryFn: () => getDownloadTask(change.resourceId),
    })
    item = toDownloadTaskListItem(task)
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404) {
      removeDownloadTaskCaches(queryClient, change.resourceId)
      return
    }
    throw error
  }
  for (const query of queryClient.getQueryCache().findAll({ queryKey: DOWNLOAD_TASKS_QUERY_KEY })) {
    const data = query.state.data as DownloadTaskPages | undefined
    const containsTask = data?.pages.some((page) => page.items.some((task) => task.id === item.id)) ?? false
    const matches = matchesDownloadTaskQuery(item, query.queryKey)
    if (containsTask) {
      queryClient.setQueryData(query.queryKey, (current) =>
        updateDownloadTaskPages(current as DownloadTaskPages | undefined, item, query.queryKey),
      )
    } else if (
      matches &&
      (change.action === 'created' || (change.action === 'status_changed' && Boolean(query.queryKey[1])))
    ) {
      await queryClient.resetQueries({ queryKey: query.queryKey, exact: true })
    }
  }
  if (change.action !== 'updated') {
    await queryClient.invalidateQueries({ queryKey: ['download-task-events', change.resourceId], exact: true })
  }
}
