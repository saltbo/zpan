import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OperationProgress, type OperationProgressState } from './operation-progress'

interface DeleteConfirmDialogProps {
  open: boolean
  count: number
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isPending: boolean
  operation?: OperationProgressState | null
  onCancelOperation?: () => void
}

export function DeleteConfirmDialog({
  open,
  count,
  onOpenChange,
  onConfirm,
  isPending,
  operation,
  onCancelOperation,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation()
  const running = !!operation

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && running) {
          onCancelOperation?.()
          return
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('files.trashConfirmTitle')}</DialogTitle>
          {!running && <DialogDescription>{t('files.trashConfirmDescription', { count })}</DialogDescription>}
        </DialogHeader>
        {operation ? (
          <OperationProgress operation={operation} onCancel={onCancelOperation ?? (() => {})} />
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
              {isPending ? t('common.loading') : t('files.moveToTrash')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
