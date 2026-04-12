import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface TrashToolbarProps {
  selectedCount: number
  hasItems: boolean
  onRestore: () => void
  onDeletePermanently: () => void
  onEmptyTrash: () => void
  isRestoring: boolean
  isDeleting: boolean
  isEmptying: boolean
}

export function TrashToolbar({
  selectedCount,
  hasItems,
  onRestore,
  onDeletePermanently,
  onEmptyTrash,
  isRestoring,
  isDeleting,
  isEmptying,
}: TrashToolbarProps) {
  const { t } = useTranslation()

  return (
    <div data-testid="trash-toolbar" className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xl font-semibold">{t('recycleBin.title')}</h2>
      <div className="flex items-center gap-2">
        {selectedCount > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={onRestore} disabled={isRestoring}>
              {isRestoring ? t('common.loading') : t('recycleBin.restore')}
            </Button>
            <Button variant="destructive" size="sm" onClick={onDeletePermanently} disabled={isDeleting}>
              {isDeleting ? t('common.loading') : t('recycleBin.deletePermanently')}
            </Button>
          </>
        )}
        <Button variant="destructive" size="sm" onClick={onEmptyTrash} disabled={!hasItems || isEmptying}>
          <Trash2 className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only">{t('recycleBin.empty')}</span>
        </Button>
      </div>
    </div>
  )
}
