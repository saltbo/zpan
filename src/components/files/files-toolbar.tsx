import { FolderInput, FolderPlus, LayoutGrid, List, Search, Trash2, Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  searchQuery: string
  onSearchChange: (query: string) => void
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
  searchQuery,
  onSearchChange,
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
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t('files.searchPlaceholder')}
                className="h-8 w-48 pl-8 pr-8 text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => onSearchChange('')}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
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
