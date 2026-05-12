import type { BackgroundJobStatus } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { ListChecks } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BackgroundTaskList } from '@/components/background-tasks/background-task-list'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cancelBackgroundJob, listBackgroundJobs, retryBackgroundJob } from '@/lib/api'
import { cn } from '@/lib/utils'

type TaskTab = 'all' | 'active' | 'completed' | 'failed'

interface TasksSearch {
  tab?: TaskTab
}

const PAGE_SIZE = 50
const tabs: TaskTab[] = ['all', 'active', 'completed', 'failed']

export const Route = createFileRoute('/_authenticated/tasks/')({
  validateSearch: (search: Record<string, unknown>): TasksSearch => {
    const tab = search.tab
    return tabs.includes(tab as TaskTab) ? { tab: tab as TaskTab } : {}
  },
  component: TasksPage,
})

export function statusForTab(tab: TaskTab): BackgroundJobStatus | undefined {
  if (tab === 'completed') return 'completed'
  if (tab === 'failed') return 'failed'
  return undefined
}

export function isActiveJobStatus(status: BackgroundJobStatus): boolean {
  return status === 'queued' || status === 'running'
}

function TasksPage() {
  const { t } = useTranslation()
  const { tab = 'all' } = useSearch({ from: '/_authenticated/tasks/' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['background-jobs', tab, PAGE_SIZE],
    queryFn: () => listBackgroundJobs(1, PAGE_SIZE, { status: statusForTab(tab) }),
  })

  const cancelMutation = useMutation({
    mutationFn: cancelBackgroundJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
      toast.success(t('tasks.cancelSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const retryMutation = useMutation({
    mutationFn: retryBackgroundJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
      toast.success(t('tasks.retrySuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const jobs = query.data?.items ?? []
  const visibleJobs = tab === 'active' ? jobs.filter((job) => isActiveJobStatus(job.status)) : jobs

  return (
    <div className="space-y-4">
      <PageHeader
        items={[{ label: t('tasks.title'), icon: <ListChecks className="size-4 text-muted-foreground" /> }]}
      />
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-3">
          {tabs.map((item) => (
            <Button
              key={item}
              variant={tab === item ? 'default' : 'outline'}
              size="sm"
              className={cn('min-w-20', tab === item && 'shadow-none')}
              onClick={() => navigate({ to: '/tasks', search: item === 'all' ? {} : { tab: item } })}
            >
              {t(`tasks.tabs.${item}`)}
            </Button>
          ))}
        </div>
        {query.isLoading ? (
          <div className="px-4 py-20 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
        ) : (
          <BackgroundTaskList
            jobs={visibleJobs}
            onCancel={(job) => cancelMutation.mutate(job.id)}
            onRetry={(job) => retryMutation.mutate(job.id)}
          />
        )}
      </Card>
    </div>
  )
}
