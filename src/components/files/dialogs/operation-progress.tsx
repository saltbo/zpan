import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

export interface OperationFailure {
  name: string
  message: string
}

export interface OperationProgressState {
  title: string
  total: number
  completed: number
  currentName: string
  cancelRequested: boolean
  finished: boolean
  failures: OperationFailure[]
}

interface OperationProgressProps {
  operation: OperationProgressState
  onCancel: () => void
  onClose?: () => void
}

export function OperationProgress({ operation, onCancel, onClose }: OperationProgressProps) {
  const { t } = useTranslation()
  const value = operation.total > 0 ? Math.round((operation.completed / operation.total) * 100) : 0
  const hasFailures = operation.failures.length > 0

  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium">{operation.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {t('files.operationProgress', {
            completed: operation.completed,
            total: operation.total,
            name: operation.currentName || '-',
          })}
        </div>
      </div>
      <Progress value={value} />
      {hasFailures && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5">
          <div className="border-b border-destructive/20 px-3 py-2 text-sm font-medium text-destructive">
            {t('files.operationFailuresTitle', { count: operation.failures.length })}
          </div>
          <div className="max-h-44 overflow-y-auto">
            {operation.failures.map((failure) => (
              <div key={`${failure.name}-${failure.message}`} className="border-b px-3 py-2 last:border-0">
                <div className="truncate text-sm font-medium" title={failure.name}>
                  {failure.name}
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" title={failure.message}>
                  {failure.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end">
        {operation.finished ? (
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        ) : (
          <Button variant="outline" onClick={onCancel} disabled={operation.cancelRequested}>
            {operation.cancelRequested ? t('files.operationCanceling') : t('common.cancel')}
          </Button>
        )}
      </div>
    </div>
  )
}
