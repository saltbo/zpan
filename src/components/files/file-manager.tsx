import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { useNavigate } from '@tanstack/react-router'
import {
  getCoreRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FilePreviewDialog, type PreviewFile } from '@/components/preview/file-preview-dialog'
import { UploadDropzone, type UploadDropzoneHandle } from '@/components/upload/upload-dropzone'
import { getObject } from '@/lib/api'
import { getColumns } from './columns'
import { DndWrapper } from './dnd-wrapper'
import { FileManagerDialogs } from './file-manager-dialogs'
import { FilesGrid } from './files-grid'
import { FilesTable } from './files-table'
import { FilesToolbar } from './files-toolbar'
import { useFileMutations } from './hooks/use-file-mutations'
import { useFilesQuery } from './hooks/use-files-query'
import { useViewMode } from './hooks/use-view-mode'
import type { BreadcrumbItem, FileActionHandlers } from './types'

function pathToBreadcrumb(path: string, rootName: string): BreadcrumbItem[] {
  const root: BreadcrumbItem = { id: '', name: rootName }
  if (!path) return [root]
  const segments = path.split('/').filter(Boolean)
  let accumulated = ''
  return [
    root,
    ...segments.map((name) => {
      accumulated = accumulated ? `${accumulated}/${name}` : name
      return { id: accumulated, name }
    }),
  ]
}

interface FileManagerProps {
  initialPath?: string
  filterType?: string
}

export function FileManager({ initialPath, filterType }: FileManagerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dropzoneRef = useRef<UploadDropzoneHandle>(null)

  const currentPath = initialPath ?? ''
  const breadcrumb = pathToBreadcrumb(currentPath, t('files.title'))

  const [viewMode, setViewMode] = useViewMode()
  const [sorting, setSorting] = useState<SortingState>(() => {
    try {
      const saved = localStorage.getItem('zpan-sort')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const handleSortingChange: typeof setSorting = (updater) => {
    setSorting((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      localStorage.setItem('zpan-sort', JSON.stringify(next))
      return next
    })
  }
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const [renameTarget, setRenameTarget] = useState<StorageObject | null>(null)
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([])
  const [moveTargetIds, setMoveTargetIds] = useState<string[]>([])
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const query = useFilesQuery(currentPath, filterType, debouncedSearch || undefined)
  const mutations = useFileMutations(currentPath)
  const items = query.data?.items ?? []

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear selection and search when path changes
  useEffect(() => {
    setRowSelection({})
    setSearchQuery('')
  }, [currentPath])

  const navigateToPath = useCallback(
    (path: string) => {
      navigate({ to: '/files', search: path ? { path } : {} })
    },
    [navigate],
  )

  const handleOpen = useCallback(
    async (item: StorageObject) => {
      if (item.dirtype !== DirType.FILE) {
        const newPath = currentPath ? `${currentPath}/${item.name}` : item.name
        navigateToPath(newPath)
        return
      }
      try {
        const obj = await getObject(item.id)
        if (!obj.downloadUrl) {
          toast.error(t('common.error'))
          return
        }
        setPreviewFile({
          id: obj.id,
          name: obj.name,
          type: obj.type,
          size: obj.size,
          downloadUrl: obj.downloadUrl,
        })
        setPreviewOpen(true)
      } catch {
        toast.error(t('common.error'))
      }
    },
    [currentPath, navigateToPath, t],
  )

  const handleDownload = useCallback(
    async (item: StorageObject) => {
      try {
        const obj = await getObject(item.id)
        if (obj.downloadUrl) window.open(obj.downloadUrl, '_blank', 'noopener,noreferrer')
      } catch {
        toast.error(t('common.error'))
      }
    },
    [t],
  )

  const handlers: FileActionHandlers = useMemo(
    () => ({
      onOpen: handleOpen,
      onRename: (item) => setRenameTarget(item),
      onTrash: (item) => setDeleteTargetIds([item.id]),
      onCopy: (item) => mutations.copyMutation.mutate({ id: item.id, parent: item.parent }),
      onMove: (item) => setMoveTargetIds([item.id]),
      onDownload: handleDownload,
    }),
    [handleOpen, handleDownload, mutations.copyMutation],
  )

  const columns = useMemo(() => getColumns(handlers, t), [handlers, t])

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    getRowId: (row) => row.id,
  })

  const selectedIds = useMemo(() => Object.keys(rowSelection).filter((k) => rowSelection[k]), [rowSelection])

  function handleDndDrop(fileIds: string[], targetFolderId: string) {
    mutations.moveMutation.mutate({ ids: fileIds, parent: targetFolderId })
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Delete' && selectedIds.length > 0) setDeleteTargetIds(selectedIds)
      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        table.toggleAllPageRowsSelected(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedIds, table])

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <UploadDropzone ref={dropzoneRef} parent={currentPath} onUploadComplete={() => mutations.invalidate()}>
      <DndWrapper onDrop={handleDndDrop}>
        <FilesToolbar
          breadcrumb={breadcrumb}
          onNavigate={(path) => navigateToPath(path)}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          selectedCount={selectedIds.length}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onUpload={() => dropzoneRef.current?.openFileDialog()}
          onNewFolder={() => setShowNewFolder(true)}
          onBatchTrash={() => setDeleteTargetIds(selectedIds)}
          onBatchMove={() => setMoveTargetIds(selectedIds)}
          onClearSelection={() => setRowSelection({})}
        />

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
            <FolderOpen className="h-16 w-16" />
            <p className="text-sm">{t('files.emptyState')}</p>
          </div>
        ) : viewMode === 'list' ? (
          <FilesTable table={table} handlers={handlers} selectedIds={selectedIds} currentPath={currentPath} />
        ) : (
          <FilesGrid table={table} handlers={handlers} selectedIds={selectedIds} currentPath={currentPath} />
        )}
      </DndWrapper>

      <FileManagerDialogs
        renameTarget={renameTarget}
        onRenameClose={() => setRenameTarget(null)}
        onRenameConfirm={(name) => {
          if (renameTarget) {
            mutations.renameMutation.mutate({ id: renameTarget.id, name }, { onSuccess: () => setRenameTarget(null) })
          }
        }}
        renamePending={mutations.renameMutation.isPending}
        showNewFolder={showNewFolder}
        onNewFolderClose={() => setShowNewFolder(false)}
        onNewFolderConfirm={(name) => {
          mutations.createFolderMutation.mutate(name, { onSuccess: () => setShowNewFolder(false) })
        }}
        newFolderPending={mutations.createFolderMutation.isPending}
        deleteTargetIds={deleteTargetIds}
        onDeleteClose={() => setDeleteTargetIds([])}
        onDeleteConfirm={() => {
          mutations.trashMutation.mutate(deleteTargetIds, {
            onSuccess: () => {
              setDeleteTargetIds([])
              setRowSelection({})
            },
          })
        }}
        deletePending={mutations.trashMutation.isPending}
        moveTargetIds={moveTargetIds}
        onMoveClose={() => setMoveTargetIds([])}
        onMoveConfirm={(targetFolderId) => {
          mutations.moveMutation.mutate(
            { ids: moveTargetIds, parent: targetFolderId },
            {
              onSuccess: () => {
                setMoveTargetIds([])
                setRowSelection({})
              },
            },
          )
        }}
        movePending={mutations.moveMutation.isPending}
      />

      <FilePreviewDialog file={previewFile} open={previewOpen} onOpenChange={setPreviewOpen} />
    </UploadDropzone>
  )
}
