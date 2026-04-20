import { FolderInput, FolderPlus, LayoutGrid, List, Search, Share2, Trash2, Upload, X } from 'lucide-react'
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
  onSearchSubmit: () => void
  onUpload: () => void
  onNewFolder: () => void
  onBatchTrash: () => void
  onBatchMove: () => void
  onClearSelection: () => void
  onShare?: () => void
}

export function FilesToolbar({
  breadcrumb,
  onNavigate,
  viewMode,
  onViewModeChange,
  selectedCount,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onUpload,
  onNewFolder,
  onBatchTrash,
  onBatchMove,
  onClearSelection,
  onShare,
}: FilesToolbarProps) {
  const { t } = useTranslation()

  return (
    <div data-testid="files-toolbar" className="flex flex-wrap items-center justify-between gap-2 py-2">
      <FilesBreadcrumb trail={breadcrumb} onNavigate={onNavigate} />

      <div className="flex items-center gap-2">
        {selectedCount > 0 ? (
          <>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {t('files.selectedCount', { count: selectedCount })}
            </span>
            {selectedCount === 1 && onShare && (
              <Button variant="outline" size="sm" onClick={onShare}>
                <Share2 className="h-4 w-4 sm:mr-1" />
                <span className="sr-only sm:not-sr-only">{t('files.share')}</span>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onBatchMove}>
              <FolderInput className="h-4 w-4 sm:mr-1" />
              <span className="sr-only sm:not-sr-only">{t('files.moveTo')}</span>
            </Button>
            <Button variant="destructive" size="sm" onClick={onBatchTrash}>
              <Trash2 className="h-4 w-4 sm:mr-1" />
              <span className="sr-only sm:not-sr-only">{t('files.moveToTrash')}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={onClearSelection}>
              <X className="h-4 w-4 sm:mr-1" />
              <span className="sr-only sm:not-sr-only">{t('common.cancel')}</span>
            </Button>
          </>
        ) : (
          <>
            <div className="relative hidden sm:block">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
                placeholder={t('files.searchPlaceholder')}
                className="h-8 w-36 pl-8 pr-8 text-sm lg:w-48"
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
              className="hidden sm:flex"
            >
              <ToggleGroupItem value="list" aria-label="List view">
                <List className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label="Grid view">
                <LayoutGrid className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            <Button variant="outline" size="sm" onClick={onNewFolder}>
              <FolderPlus className="h-4 w-4 sm:mr-1" />
              <span className="sr-only sm:not-sr-only">{t('files.newFolder')}</span>
            </Button>
            <Button size="sm" onClick={onUpload}>
              <Upload className="h-4 w-4 sm:mr-1" />
              <span className="sr-only sm:not-sr-only">{t('files.upload')}</span>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
