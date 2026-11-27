import type { BackgroundJob, BackgroundJobStatus } from '@shared/types'
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { ListChecks } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  BACKGROUND_TASK_FILTERS,
  type BackgroundTaskFilter,
  BackgroundTaskList,
} from '@/components/background-tasks/task-list'
import { PageHeader } from '@/components/layout/page-header'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { cancelBackgroundJob, listBackgroundJobs, retryBackgroundJob } from '@/lib/api'
import { enumParam } from '@/lib/list-search'

export const tasksSearchSchema = z.object({ filter: enumParam(BACKGROUND_TASK_FILTERS) })

export const Route = createFileRoute('/_authenticated/tasks/')({
  validateSearch: tasksSearchSchema,
  component: TasksPage,
})

const PAGE_SIZE = 50
const QUERY_KEY = ['background-jobs']

export function TasksPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const filter = useSearch({ from: '/_authenticated/tasks/' }).filter ?? 'active'

  function setFilter(next: BackgroundTaskFilter) {
    navigate({ to: '/tasks', search: { filter: next === 'active' ? undefined : next } })
  }

  const status = statusForFilter(filter)
  const jobsQuery = useInfiniteQuery({
    queryKey: [...QUERY_KEY, filter],
    queryFn: async ({ pageParam }) => {
      const page = await listBackgroundJobs({ status, pageToken: pageParam, pageSize: PAGE_SIZE })
      return filter === 'active' ? { ...page, items: page.items.filter(isActiveJob) } : page
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
    // Keep the previous filter's rows on screen while the next one loads, so the
    // page layout and the filter the user just picked stay in place.
    placeholderData: keepPreviousData,
  })
  const loadMoreRef = useInfiniteScroll<HTMLDivElement>({
    hasNextPage: jobsQuery.hasNextPage,
    isFetchingNextPage: jobsQuery.isFetchingNextPage,
    fetchNextPage: jobsQuery.fetchNextPage,
  })

  const cancelMutation = useMutation({
    mutationFn: cancelBackgroundJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(t('tasks.cancelSuccess'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const retryMutation = useMutation({
    mutationFn: retryBackgroundJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      setFilter('active')
      toast.success(t('tasks.retrySuccess'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  if (jobsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  const jobs = jobsQuery.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        items={[
          {
            label: t('tasks.title'),
            icon: <ListChecks className="size-4 text-muted-foreground" />,
          },
        ]}
      />

      <BackgroundTaskList
        jobs={jobs}
        total={jobs.length}
        refreshing={jobsQuery.isPlaceholderData}
        filter={filter}
        onFilterChange={setFilter}
        onCancel={(id) => cancelMutation.mutate(id)}
        onRetry={(id) => retryMutation.mutate(id)}
        cancelingId={cancelMutation.variables}
        retryingId={retryMutation.variables}
      />
      {jobsQuery.hasNextPage && (
        <div ref={loadMoreRef} className="py-3 text-center text-sm text-muted-foreground">
          {jobsQuery.isFetchingNextPage ? t('common.loading') : ''}
        </div>
      )}
    </div>
  )
}

function isActiveJob(job: BackgroundJob) {
  return job.status === 'queued' || job.status === 'running'
}

function statusForFilter(filter: BackgroundTaskFilter): BackgroundJobStatus | undefined {
  if (filter === 'completed') return 'completed'
  if (filter === 'failed') return 'failed'
  return undefined
}
