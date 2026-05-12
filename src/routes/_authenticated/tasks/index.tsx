import type { BackgroundJobStatus } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ListChecks } from 'lucide-react'
import { useState } from 'react'
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

  const status = statusForFilter(filter)
  const jobsQuery = useQuery({
    queryKey: [...QUERY_KEY, status],
    queryFn: () => listBackgroundJobs({ status, page: 1, pageSize: PAGE_SIZE }),
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

  const jobs = jobsQuery.data?.items ?? []
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
        total={filter === 'active' ? visibleJobs.length : (jobsQuery.data?.total ?? 0)}
        filter={filter}
        onFilterChange={setFilter}
        onCancel={(id) => cancelMutation.mutate(id)}
        onRetry={(id) => retryMutation.mutate(id)}
        cancelingId={cancelMutation.variables}
        retryingId={retryMutation.variables}
      />
    </div>
  )
}

function statusForFilter(filter: BackgroundTaskFilter): BackgroundJobStatus | undefined {
  if (filter === 'completed') return 'completed'
  if (filter === 'failed') return 'failed'
  return undefined
}
