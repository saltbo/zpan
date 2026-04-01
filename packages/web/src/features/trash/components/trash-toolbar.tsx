import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TrashToolbarProps {
  selectedCount: number
  totalCount: number
  onBatchRestore: () => void
  onBatchDelete: () => void
  onEmptyTrash: () => void
}

export function TrashToolbar({
  selectedCount,
  totalCount,
  onBatchRestore,
  onBatchDelete,
  onEmptyTrash,
}: TrashToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <h1 className="text-lg font-semibold">Trash</h1>

      {totalCount > 0 && (
        <Button size="sm" variant="destructive" className="ml-auto" onClick={onEmptyTrash}>
          <Trash2 className="mr-1 h-4 w-4" />
          Empty Trash
        </Button>
      )}

      {selectedCount > 0 && (
        <div className="flex items-center gap-2 border-l pl-2 ml-2">
          <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
          <Button size="sm" variant="outline" onClick={onBatchRestore}>
            <RotateCcw className="mr-1 h-4 w-4" />
            Restore
          </Button>
          <Button size="sm" variant="destructive" onClick={onBatchDelete}>
            <Trash2 className="mr-1 h-4 w-4" />
            Delete Forever
          </Button>
        </div>
      )}
    </div>
  )
}
