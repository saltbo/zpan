import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  getCoreRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { FolderOpen, FolderPlus, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader, type PageHeaderItem } from '@/components/layout/page-header'
import { FilePreviewDialog, type PreviewFile } from '@/components/preview/file-preview-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { UploadDropzone, type UploadDropzoneHandle } from '@/components/upload/upload-dropzone'
import { getObject, listObjectsByPath } from '@/lib/api'
import { getColumns } from './columns'
import { NameConflictDialog } from './dialogs/name-conflict-dialog'
import { DndWrapper } from './dnd-wrapper'
import { FileManagerDialogs } from './file-manager-dialogs'
import { FilesGrid } from './files-grid'
import { FilesTable } from './files-table'
import { FilesToolbar } from './files-toolbar'
import { useConflictResolver, withConflictRetry } from './hooks/use-conflict-resolver'
import { useFileMutations } from './hooks/use-file-mutations'
import { useViewMode } from './hooks/use-view-mode'
import type { BreadcrumbItem, FileActionHandlers } from './types'

const FILES_PAGE_SIZE = 500

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
  rootName?: string
  onNavigatePath?: (path: string) => void
  dataSource?: {
    queryKeyPrefix: readonly unknown[]
    list: (path: string, opts: { filterType?: string; search?: string }) => Promise<{ items: StorageObject[] }>
    getPreviewFile?: (item: StorageObject) => Promise<PreviewFile | null>
    download?: (item: StorageObject) => Promise<void> | void
  }
  capabilities?: {
    selection?: boolean
    dragAndDrop?: boolean
    upload?: boolean
    createFolder?: boolean
    rename?: boolean
    copy?: boolean
    move?: boolean
    trash?: boolean
    share?: boolean
  }
  emptyStateLabel?: string
}

export function FileManager({
  initialPath,
  filterType,
  rootName,
  onNavigatePath,
  dataSource,
  capabilities,
  emptyStateLabel,
}: FileManagerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dropzoneRef = useRef<UploadDropzoneHandle>(null)

  const currentPath = initialPath ?? ''
  const breadcrumb = pathToBreadcrumb(currentPath, rootName ?? t('files.title'))
  const resolvedCapabilities = useMemo(
    () => ({
      selection: capabilities?.selection ?? !dataSource,
      dragAndDrop: capabilities?.dragAndDrop ?? !dataSource,
      upload: capabilities?.upload ?? !dataSource,
      createFolder: capabilities?.createFolder ?? !dataSource,
      rename: capabilities?.rename ?? !dataSource,
      copy: capabilities?.copy ?? !dataSource,
      move: capabilities?.move ?? !dataSource,
      trash: capabilities?.trash ?? !dataSource,
      share: capabilities?.share ?? !dataSource,
    }),
    [capabilities, dataSource],
  )

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
  const [shareTarget, setShareTarget] = useState<StorageObject | null>(null)
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const query = useQuery({
    queryKey: [...(dataSource?.queryKeyPrefix ?? ['objects', 'active', 'path']), currentPath, filterType ?? ''],
    queryFn: () =>
      dataSource?.list(currentPath, { filterType }) ??
      listObjectsByPath(currentPath, 'active', 1, FILES_PAGE_SIZE, {
        type: filterType,
      }),
  })
  const mutations = useFileMutations(currentPath)
  const conflict = useConflictResolver()
  const items = query.data?.items ?? []

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear selection when path changes
  useEffect(() => {
    setRowSelection({})
  }, [currentPath])

  const navigateToPath = useCallback(
    (path: string) => {
      if (onNavigatePath) {
        onNavigatePath(path)
        return
      }
      navigate({ to: '/files', search: path ? { path } : {} })
    },
    [navigate, onNavigatePath],
  )

  const handleOpen = useCallback(
    async (item: StorageObject) => {
      if (item.dirtype !== DirType.FILE) {
        const newPath = currentPath ? `${currentPath}/${item.name}` : item.name
        navigateToPath(newPath)
        return
      }
      try {
        const file =
          (await dataSource?.getPreviewFile?.(item)) ??
          (await getObject(item.id).then((obj) =>
            obj.downloadUrl
              ? {
                  id: obj.id,
                  name: obj.name,
                  type: obj.type,
                  size: obj.size,
                  downloadUrl: obj.downloadUrl,
                }
              : null,
          ))
        if (!file) {
          toast.error(t('common.error'))
          return
        }
        setPreviewFile(file)
        setPreviewOpen(true)
      } catch {
        toast.error(t('common.error'))
      }
    },
    [currentPath, dataSource, navigateToPath, t],
  )

  const handleDownload = useCallback(
    async (item: StorageObject) => {
      try {
        if (dataSource?.download) {
          await dataSource.download(item)
          return
        }
        const obj = await getObject(item.id)
        if (obj.downloadUrl) window.open(obj.downloadUrl, '_blank', 'noopener,noreferrer')
      } catch {
        toast.error(t('common.error'))
      }
    },
    [dataSource, t],
  )

  const handlers: FileActionHandlers = useMemo(
    () => ({
      onOpen: handleOpen,
      onRename: resolvedCapabilities.rename ? (item) => setRenameTarget(item) : undefined,
      onTrash: resolvedCapabilities.trash ? (item) => setDeleteTargetIds([item.id]) : undefined,
      onCopy: resolvedCapabilities.copy
        ? (item) => {
            const kind = item.dirtype === DirType.FILE ? 'file' : 'folder'
            conflict.reset()
            withConflictRetry(conflict.prompt, kind, (strategy) =>
              mutations.copyMutation.mutateAsync({ id: item.id, parent: item.parent, onConflict: strategy }),
            ).catch((err) => toast.error(err.message))
          }
        : undefined,
      onMove: resolvedCapabilities.move ? (item) => setMoveTargetIds([item.id]) : undefined,
      onDownload: handleDownload,
      onShare: resolvedCapabilities.share ? (item) => setShareTarget(item) : undefined,
    }),
    [handleOpen, handleDownload, resolvedCapabilities, mutations.copyMutation, conflict.prompt, conflict.reset],
  )

  const columns = useMemo(
    () => getColumns(handlers, t, { selectionEnabled: resolvedCapabilities.selection }),
    [handlers, resolvedCapabilities.selection, t],
  )

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: resolvedCapabilities.selection,
    getRowId: (row) => row.id,
  })

  const selectedIds = useMemo(
    () => (resolvedCapabilities.selection ? Object.keys(rowSelection).filter((k) => rowSelection[k]) : []),
    [resolvedCapabilities.selection, rowSelection],
  )

  const handleToolbarShare = useCallback(() => {
    const id = selectedIds[0]
    const item = items.find((i) => i.id === id) ?? null
    setShareTarget(item)
  }, [selectedIds, items])

  function handleDndDrop(fileIds: string[], targetFolderId: string) {
    conflict.reset()
    withConflictRetry(conflict.prompt, 'file', (strategy) =>
      mutations.moveMutation.mutateAsync({ ids: fileIds, parent: targetFolderId, onConflict: strategy }),
    ).catch((err) => toast.error(err.message))
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!resolvedCapabilities.selection) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Delete' && selectedIds.length > 0) setDeleteTargetIds(selectedIds)
      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        table.toggleAllPageRowsSelected(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [resolvedCapabilities.selection, selectedIds, table])

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  const headerItems: PageHeaderItem[] = breadcrumb.map((item, idx) => {
    const isRoot = idx === 0
    const isLast = idx === breadcrumb.length - 1
    return {
      label: item.name,
      icon: isRoot ? <FolderOpen className="size-4 text-muted-foreground" /> : undefined,
      onClick: !isLast ? () => navigateToPath(item.id) : undefined,
    }
  })

  const headerActions =
    resolvedCapabilities.createFolder || resolvedCapabilities.upload ? (
      <>
        {resolvedCapabilities.createFolder && (
          <Button variant="outline" size="sm" onClick={() => setShowNewFolder(true)}>
            <FolderPlus />
            <span className="sr-only sm:not-sr-only">{t('files.newFolder')}</span>
          </Button>
        )}
        {resolvedCapabilities.upload && (
          <Button size="sm" onClick={() => dropzoneRef.current?.openFileDialog()}>
            <Upload />
            <span className="sr-only sm:not-sr-only">{t('files.upload')}</span>
          </Button>
        )}
      </>
    ) : null

  const content = (
    <div className="space-y-4">
      <PageHeader items={headerItems} actions={headerActions} />

      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <FilesToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          selectedCount={selectedIds.length}
          totalItems={items.length}
          onBatchTrash={resolvedCapabilities.trash ? () => setDeleteTargetIds(selectedIds) : undefined}
          onBatchMove={resolvedCapabilities.move ? () => setMoveTargetIds(selectedIds) : undefined}
          onClearSelection={resolvedCapabilities.selection ? () => setRowSelection({}) : undefined}
          onShare={resolvedCapabilities.share ? handleToolbarShare : undefined}
        />

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
            <FolderOpen className="h-16 w-16" />
            <p className="text-sm">{emptyStateLabel ?? t('files.emptyState')}</p>
          </div>
        ) : viewMode === 'list' ? (
          <FilesTable
            table={table}
            handlers={handlers}
            selectedIds={selectedIds}
            currentPath={currentPath}
            dragAndDropEnabled={resolvedCapabilities.dragAndDrop}
            selectionEnabled={resolvedCapabilities.selection}
          />
        ) : (
          <div className="p-4">
            <FilesGrid
              table={table}
              handlers={handlers}
              selectedIds={selectedIds}
              currentPath={currentPath}
              dragAndDropEnabled={resolvedCapabilities.dragAndDrop}
              selectionEnabled={resolvedCapabilities.selection}
            />
          </div>
        )}
      </Card>

      {resolvedCapabilities.rename ||
      resolvedCapabilities.createFolder ||
      resolvedCapabilities.trash ||
      resolvedCapabilities.move ||
      resolvedCapabilities.share ? (
        <>
          <FileManagerDialogs
            renameTarget={renameTarget}
            onRenameClose={() => setRenameTarget(null)}
            onRenameConfirm={(name) => {
              if (!renameTarget) return
              const kind = renameTarget.dirtype === DirType.FILE ? 'file' : 'folder'
              conflict.reset()
              withConflictRetry(conflict.prompt, kind, (strategy) =>
                mutations.renameMutation.mutateAsync({ id: renameTarget.id, name, onConflict: strategy }),
              )
                .then(() => setRenameTarget(null))
                .catch((err) => toast.error(err.message))
            }}
            renamePending={mutations.renameMutation.isPending}
            showNewFolder={showNewFolder}
            onNewFolderClose={() => setShowNewFolder(false)}
            onNewFolderConfirm={(name) => {
              conflict.reset()
              withConflictRetry(conflict.prompt, 'folder', (strategy) =>
                mutations.createFolderMutation.mutateAsync({ name, onConflict: strategy }),
              )
                .then(() => setShowNewFolder(false))
                .catch((err) => toast.error(err.message))
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
              conflict.reset()
              withConflictRetry(
                conflict.prompt,
                'file',
                (strategy) =>
                  mutations.moveMutation.mutateAsync({
                    ids: moveTargetIds,
                    parent: targetFolderId,
                    onConflict: strategy,
                  }),
                { showApplyToAll: moveTargetIds.length > 1 },
              )
                .then(() => {
                  setMoveTargetIds([])
                  setRowSelection({})
                })
                .catch((err) => toast.error(err.message))
            }}
            movePending={mutations.moveMutation.isPending}
            shareTarget={shareTarget}
            onShareClose={() => setShareTarget(null)}
          />

          <NameConflictDialog {...conflict.dialogState} />
        </>
      ) : null}

      <FilePreviewDialog file={previewFile} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  )

  if (!resolvedCapabilities.upload && !resolvedCapabilities.dragAndDrop) {
    return content
  }

  return (
    <UploadDropzone
      ref={dropzoneRef}
      parent={currentPath}
      onUploadComplete={() => mutations.invalidate()}
      conflictPrompt={conflict.prompt}
      onConflictBatchStart={conflict.reset}
    >
      {resolvedCapabilities.dragAndDrop ? <DndWrapper onDrop={handleDndDrop}>{content}</DndWrapper> : content}
    </UploadDropzone>
  )
}
