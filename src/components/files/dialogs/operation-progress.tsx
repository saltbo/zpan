import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

export interface OperationProgressState {
  title: string
  total: number
  completed: number
  currentName: string
  cancelRequested: boolean
}

interface OperationProgressProps {
  operation: OperationProgressState
  onCancel: () => void
}

export function OperationProgress({ operation, onCancel }: OperationProgressProps) {
  const { t } = useTranslation()
  const value = operation.total > 0 ? Math.round((operation.completed / operation.total) * 100) : 0

  return (
    <div className="space-y-4">
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
      <div className="flex justify-end">
        <Button variant="outline" onClick={onCancel} disabled={operation.cancelRequested}>
          {operation.cancelRequested ? t('files.operationCanceling') : t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
