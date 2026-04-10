import { FolderInput, FolderPlus, LayoutGrid, List, Trash2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { FilesBreadcrumb } from './files-breadcrumb'
import type { ViewMode } from './hooks/use-view-mode'
import type { BreadcrumbItem } from './types'

interface FilesToolbarProps {
  breadcrumb: BreadcrumbItem[]
  onNavigate: (folderId: string) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  selectedCount: number
  onUpload: () => void
  onNewFolder: () => void
  onBatchTrash: () => void
  onBatchMove: () => void
  onClearSelection: () => void
}

export function FilesToolbar({
  breadcrumb,
  onNavigate,
  viewMode,
  onViewModeChange,
  selectedCount,
  onUpload,
  onNewFolder,
  onBatchTrash,
  onBatchMove,
  onClearSelection,
}: FilesToolbarProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <FilesBreadcrumb trail={breadcrumb} onNavigate={onNavigate} />

      <div className="flex items-center gap-2">
        {selectedCount > 0 ? (
          <>
            <span className="text-sm text-muted-foreground">{t('files.selectedCount', { count: selectedCount })}</span>
            <Button variant="outline" size="sm" onClick={onBatchMove}>
              <FolderInput className="mr-1 h-4 w-4" />
              {t('files.moveTo')}
            </Button>
            <Button variant="destructive" size="sm" onClick={onBatchTrash}>
              <Trash2 className="mr-1 h-4 w-4" />
              {t('files.moveToTrash')}
            </Button>
            <Button variant="outline" size="sm" onClick={onClearSelection}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={viewMode}
              onValueChange={(v) => v && onViewModeChange(v as ViewMode)}
            >
              <ToggleGroupItem value="list" aria-label="List view">
                <List className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label="Grid view">
                <LayoutGrid className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            <Button variant="outline" size="sm" onClick={onNewFolder}>
              <FolderPlus className="mr-1 h-4 w-4" />
              {t('files.newFolder')}
            </Button>
            <Button size="sm" onClick={onUpload}>
              <Upload className="mr-1 h-4 w-4" />
              {t('files.upload')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
