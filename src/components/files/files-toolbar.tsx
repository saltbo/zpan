import { Copy, Download, FolderInput, LayoutGrid, List, Share2, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ViewMode } from './hooks/use-view-mode'

interface FilesToolbarProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  selectedCount: number
  totalItems: number
  onBatchTrash?: () => void
  onBatchMove?: () => void
  onBatchCopy?: () => void
  onBatchDownload?: () => void
  onClearSelection?: () => void
  onShare?: () => void
}

export function FilesToolbar({
  viewMode,
  onViewModeChange,
  selectedCount,
  totalItems,
  onBatchTrash,
  onBatchMove,
  onBatchCopy,
  onBatchDownload,
  onClearSelection,
  onShare,
}: FilesToolbarProps) {
  const { t } = useTranslation()
  const selectionActive = selectedCount > 0 && !!(onBatchMove || onBatchTrash || onClearSelection)

  if (selectionActive) {
    return (
      <div data-testid="files-toolbar-selection" className="flex items-center gap-2 border-b bg-primary/5 px-4 py-2">
        <span className="text-sm font-medium">{t('files.selectedCount', { count: selectedCount })}</span>
        <div className="mx-1 h-5 w-px bg-border" />
        {onBatchMove && (
          <Button variant="outline" size="icon-sm" onClick={onBatchMove} title={t('files.moveTo')}>
            <FolderInput />
          </Button>
        )}
        {onBatchCopy && (
          <Button variant="outline" size="icon-sm" onClick={onBatchCopy} title={t('files.copy')}>
            <Copy />
          </Button>
        )}
        {onBatchDownload && (
          <Button variant="outline" size="icon-sm" onClick={onBatchDownload} title={t('files.download')}>
            <Download />
          </Button>
        )}
        {selectedCount === 1 && onShare && (
          <Button variant="outline" size="icon-sm" onClick={onShare} title={t('files.share')}>
            <Share2 />
          </Button>
        )}
        {onBatchTrash && (
          <Button variant="outline" size="icon-sm" onClick={onBatchTrash} title={t('files.moveToTrash')}>
            <Trash2 className="text-destructive" />
          </Button>
        )}
        <div className="ml-auto flex items-center">
          {onClearSelection && (
            <Button variant="ghost" size="icon-sm" onClick={onClearSelection} title={t('common.cancel')}>
              <X />
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="files-toolbar"
      className="flex items-center justify-between gap-2 border-b bg-background px-4 py-2"
    >
      <span className="text-sm text-muted-foreground">{t('files.count', { count: totalItems })}</span>
      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={viewMode}
          onValueChange={(v) => v && onViewModeChange(v as ViewMode)}
          className="hidden sm:flex"
        >
          <ToggleGroupItem value="list" aria-label="List view">
            <List className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <LayoutGrid className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  )
}
