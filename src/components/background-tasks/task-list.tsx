import type { BackgroundJob, BackgroundJobStatus } from '@shared/types'
import { Archive, FileArchive, RotateCcw, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface BackgroundTaskListProps {
  jobs: BackgroundJob[]
  total: number
  filter: BackgroundTaskFilter
  onFilterChange: (filter: BackgroundTaskFilter) => void
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  cancelingId?: string
  retryingId?: string
}

export type BackgroundTaskFilter = 'active' | 'completed' | 'failed'

export const BACKGROUND_TASK_FILTERS: BackgroundTaskFilter[] = ['active', 'completed', 'failed']

export function BackgroundTaskList({
  jobs,
  total,
  filter,
  onFilterChange,
  onCancel,
  onRetry,
  cancelingId,
  retryingId,
}: BackgroundTaskListProps) {
  const { t } = useTranslation()

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <div className="flex items-center justify-between gap-3 border-b bg-background px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {BACKGROUND_TASK_FILTERS.map((item) => (
            <Button
              key={item}
              variant={filter === item ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onFilterChange(item)}
            >
              {t(`tasks.filter.${item}`)}
            </Button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{t('tasks.count', { count: total })}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">{t('tasks.colTask')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('tasks.colStatus')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('tasks.colProgress')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('tasks.colCurrentFile')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('tasks.colCreated')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('tasks.colFinished')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('tasks.colResult')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b last:border-b-0">
                <td className="px-4 py-3">
                  <div className="flex min-w-44 items-center gap-2">
                    {job.type === 'archive_extract' ? (
                      <FileArchive className="size-4 text-muted-foreground" />
                    ) : (
                      <Archive className="size-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="font-medium">{formatTaskType(job.type, t)}</div>
                      <div className="text-xs text-muted-foreground">{job.id}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <TaskStatusBadge status={job.status} />
                </td>
                <td className="min-w-44 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Progress value={taskProgressPercent(job)} className="w-28" />
                    <span className="w-10 text-xs text-muted-foreground">{taskProgressPercent(job)}%</span>
                  </div>
                </td>
                <td className="max-w-48 px-4 py-3 text-muted-foreground">
                  <span className="block truncate">{job.progress.currentFilename ?? '-'}</span>
                  {job.errorMessage && <span className="mt-1 block truncate text-destructive">{job.errorMessage}</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(job.createdAt)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(job.finishedAt)}</td>
                <td className="max-w-56 px-4 py-3 text-muted-foreground">
                  <span className="block truncate">{formatResult(job, t)}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    {job.cancelable && (
                      <Button
                        variant="outline"
                        size="icon-sm"
                        title={t('tasks.cancel')}
                        disabled={cancelingId === job.id}
                        onClick={() => onCancel(job.id)}
                      >
                        <Square />
                      </Button>
                    )}
                    {job.status === 'failed' && job.retryable && (
                      <Button
                        variant="outline"
                        size="icon-sm"
                        title={t('tasks.retry')}
                        disabled={retryingId === job.id}
                        onClick={() => onRetry(job.id)}
                      >
                        <RotateCcw />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  {t('tasks.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function TaskStatusBadge({ status }: { status: BackgroundJobStatus }) {
  const { t } = useTranslation()
  const variant = status === 'failed' ? 'destructive' : status === 'completed' ? 'secondary' : 'outline'
  return (
    <Badge variant={variant} className={cn(status === 'running' && 'border-primary/40 text-primary')}>
      {t(`tasks.status.${status}`)}
    </Badge>
  )
}

export function taskProgressPercent(job: BackgroundJob): number {
  if (job.status === 'completed') return 100
  if (job.progress.inputBytes <= 0) return 0
  return Math.min(100, Math.round((job.progress.processedBytes / job.progress.inputBytes) * 100))
}

export function formatTaskType(type: string, t: (key: string) => string): string {
  if (type === 'archive_compress') return t('tasks.type.archiveCompress')
  if (type === 'archive_extract') return t('tasks.type.archiveExtract')
  return type
}

export function formatResult(job: BackgroundJob, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (job.status === 'failed') return job.errorMessage ?? '-'
  const outputName = typeof job.resultMetadata?.outputName === 'string' ? job.resultMetadata.outputName : null
  if (outputName) return outputName
  const outputBytes = typeof job.resultMetadata?.outputBytes === 'number' ? job.resultMetadata.outputBytes : null
  if (outputBytes !== null) return t('tasks.result.outputBytes', { bytes: outputBytes })
  return '-'
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
