import type { BackgroundJobStatus } from '@shared/types'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ListChecks } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type BackgroundTaskFilter, BackgroundTaskList } from '@/components/background-tasks/task-list'
import { PageHeader } from '@/components/layout/page-header'
import { cancelBackgroundJob, listBackgroundJobs, retryBackgroundJob } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/tasks/')({
  component: TasksPage,
})

const PAGE_SIZE = 50
const QUERY_KEY = ['background-jobs']

function TasksPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<BackgroundTaskFilter>('active')
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const status = statusForFilter(filter)
  const jobsQuery = useInfiniteQuery({
    queryKey: [...QUERY_KEY, status],
    queryFn: ({ pageParam }) => listBackgroundJobs({ status, pageToken: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
  })

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !jobsQuery.hasNextPage) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !jobsQuery.isFetchingNextPage) void jobsQuery.fetchNextPage()
      },
      { rootMargin: '320px 0px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [jobsQuery.fetchNextPage, jobsQuery.hasNextPage, jobsQuery.isFetchingNextPage])

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
  const visibleJobs =
    filter === 'active' ? jobs.filter((job) => job.status === 'queued' || job.status === 'running') : jobs

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
        jobs={visibleJobs}
        total={visibleJobs.length}
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

function statusForFilter(filter: BackgroundTaskFilter): BackgroundJobStatus | undefined {
  if (filter === 'completed') return 'completed'
  if (filter === 'failed') return 'failed'
  return undefined
}
