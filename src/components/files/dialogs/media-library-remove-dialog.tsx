import type { MediaLibrary } from '@shared/schemas'
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

interface MediaLibraryRemoveDialogProps {
  library: MediaLibrary | null
  isPending: boolean
  onCancel: () => void
  onConfirm: (library: MediaLibrary) => void
}

export function MediaLibraryRemoveDialog({ library, isPending, onCancel, onConfirm }: MediaLibraryRemoveDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={!!library}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('mediaLibrary.removeConfirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('mediaLibrary.removeConfirmDescription', { path: `/${library?.folderPath}/library.json` })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={isPending} onClick={() => library && onConfirm(library)}>
            {t('mediaLibrary.remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
