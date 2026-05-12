import type { BackgroundJob, BackgroundJobStatus, BackgroundJobType } from '@shared/types'
import { Archive, CircleAlert, CircleCheck, Clock3, Loader2, RotateCcw, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatSize } from '@/lib/format'

interface BackgroundTaskListProps {
  jobs: BackgroundJob[]
  onCancel: (job: BackgroundJob) => void
  onRetry: (job: BackgroundJob) => void
}

const jobTypeKeys: Record<string, string> = {
  archive_compress: 'tasks.type.archive_compress',
  archive_extract: 'tasks.type.archive_extract',
}

const statusKeys: Record<BackgroundJobStatus, string> = {
  queued: 'tasks.status.queued',
  running: 'tasks.status.running',
  completed: 'tasks.status.completed',
  failed: 'tasks.status.failed',
  canceled: 'tasks.status.canceled',
}

export function jobTypeLabelKey(type: BackgroundJobType): string {
  return jobTypeKeys[type] ?? type
}

export function jobStatusLabelKey(status: BackgroundJobStatus): string {
  return statusKeys[status]
}

export function jobProgressPercent(job: BackgroundJob): number {
  const total = job.progress.inputBytes || job.progress.outputBytes
  if (total <= 0) return job.status === 'completed' ? 100 : 0
  return Math.min(100, Math.round((job.progress.processedBytes / total) * 100))
}

export function jobResultSummary(job: BackgroundJob): string | null {
  if (job.errorMessage) return job.errorMessage
  if (!job.resultMetadata) return null

  const outputName = job.resultMetadata.outputName
  if (typeof outputName === 'string') return outputName

  const outputBytes = job.resultMetadata.outputBytes
  if (typeof outputBytes === 'number') return formatSize(outputBytes)

  const matterIds = job.resultMetadata.matterIds
  if (Array.isArray(matterIds)) return String(matterIds.length)

  return null
}

function StatusIcon({ status }: { status: BackgroundJobStatus }) {
  if (status === 'completed') return <CircleCheck className="size-3.5 text-primary" />
  if (status === 'failed') return <CircleAlert className="size-3.5 text-destructive" />
  if (status === 'running') return <Loader2 className="size-3.5 animate-spin text-primary" />
  return <Clock3 className="size-3.5 text-muted-foreground" />
}

export function BackgroundTaskList({ jobs, onCancel, onRetry }: BackgroundTaskListProps) {
  const { t } = useTranslation()

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center text-muted-foreground">
        <Archive className="size-12" />
        <p className="text-sm">{t('tasks.empty')}</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('tasks.table.job')}</TableHead>
          <TableHead>{t('tasks.table.status')}</TableHead>
          <TableHead>{t('tasks.table.progress')}</TableHead>
          <TableHead className="hidden lg:table-cell">{t('tasks.table.currentFile')}</TableHead>
          <TableHead className="hidden md:table-cell">{t('tasks.table.created')}</TableHead>
          <TableHead className="hidden md:table-cell">{t('tasks.table.finished')}</TableHead>
          <TableHead className="text-right">{t('tasks.table.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const summary = jobResultSummary(job)
          const percent = jobProgressPercent(job)

          return (
            <TableRow key={job.id}>
              <TableCell className="min-w-48">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{t(jobTypeLabelKey(job.type))}</span>
                  {summary && <span className="max-w-64 truncate text-xs text-muted-foreground">{summary}</span>}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={job.status === 'failed' ? 'destructive' : 'outline'} className="gap-1.5">
                  <StatusIcon status={job.status} />
                  {t(jobStatusLabelKey(job.status))}
                </Badge>
              </TableCell>
              <TableCell className="min-w-36">
                <div className="flex items-center gap-2">
                  <Progress value={percent} className="h-1.5" />
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{percent}%</span>
                </div>
              </TableCell>
              <TableCell className="hidden max-w-48 truncate text-muted-foreground lg:table-cell">
                {job.progress.currentFilename ?? '-'}
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{formatDate(job.createdAt)}</TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">
                {job.finishedAt ? formatDate(job.finishedAt) : '-'}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  {job.retryable && (
                    <Button variant="outline" size="icon-sm" onClick={() => onRetry(job)} title={t('tasks.retry')}>
                      <RotateCcw />
                    </Button>
                  )}
                  {job.cancelable && (
                    <Button variant="outline" size="icon-sm" onClick={() => onCancel(job)} title={t('tasks.cancel')}>
                      <Square />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
