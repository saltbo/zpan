import { RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface TrashToolbarProps {
  selectedCount: number
  onRestore: () => void
  onDeletePermanently: () => void
  isRestoring: boolean
  isDeleting: boolean
}

export function TrashToolbar({
  selectedCount,
  onRestore,
  onDeletePermanently,
  isRestoring,
  isDeleting,
}: TrashToolbarProps) {
  const { t } = useTranslation()
  if (selectedCount === 0) return null

  return (
    <div data-testid="trash-toolbar" className="flex items-center gap-2 rounded-md border bg-primary/5 px-3 py-2">
      <span className="text-sm font-medium">{t('files.selectedCount', { count: selectedCount })}</span>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onRestore}
        disabled={isRestoring}
        title={t('recycleBin.restore')}
      >
        <RotateCcw className="text-primary" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onDeletePermanently}
        disabled={isDeleting}
        title={t('recycleBin.deletePermanently')}
      >
        <Trash2 className="text-destructive" />
      </Button>
    </div>
  )
}
