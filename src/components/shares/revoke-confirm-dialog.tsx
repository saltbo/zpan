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

interface RevokeConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filename: string
  isPending: boolean
  onConfirm: () => void
}

export function RevokeConfirmDialog({ open, onOpenChange, filename, isPending, onConfirm }: RevokeConfirmDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('shares.revokeTitle')}</DialogTitle>
          <DialogDescription>{t('shares.revokeConfirm', { name: filename })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {t('shares.revoke')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
