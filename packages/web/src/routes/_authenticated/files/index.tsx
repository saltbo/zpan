import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { DirType } from '@zpan/shared/constants'
import type { StorageObject } from '@zpan/shared/types'
import {
  ChevronRight,
  Copy,
  Download,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid,
  List,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { fetchObjects } from '@/lib/api'
import {
  copyItem,
  createFolder,
  downloadFile,
  invalidateObjects,
  objectsQueryKey,
  renameItem,
  trashItems,
  uploadFile,
} from '@/lib/file-manager-adapter'

export const Route = createFileRoute('/_authenticated/files/')({
  validateSearch: (search: Record<string, unknown>) => ({
    folder: (search.folder as string) ?? '',
  }),
  component: FilesPage,
})

type ViewMode = 'list' | 'grid'

function FilesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { folder } = Route.useSearch()
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [newFolderMode, setNewFolderMode] = useState(false)

  const objectsQuery = useQuery({
    queryKey: objectsQueryKey(folder),
    queryFn: () => fetchObjects({ parent: folder, status: 'active' }),
  })

  const items = objectsQuery.data?.items ?? []
  const folders = items.filter((item) => item.dirtype !== DirType.FILE)
  const files = items.filter((item) => item.dirtype === DirType.FILE)
  const sorted = [...folders, ...files]

  const refresh = useCallback(() => invalidateObjects(queryClient, folder), [queryClient, folder])

  const trashMutation = useMutation({
    mutationFn: (ids: string[]) => trashItems(ids),
    onSuccess: () => {
      toast.success(t('files.movedToTrash'))
      refresh()
    },
    onError: (err) => toast.error(err.message),
  })

  const copyMutation = useMutation({
    mutationFn: ({ id, parent }: { id: string; parent: string }) => copyItem(id, parent),
    onSuccess: () => {
      toast.success(t('files.copied'))
      refresh()
    },
    onError: (err) => toast.error(err.message),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameItem(id, name),
    onSuccess: () => {
      setRenamingId(null)
      toast.success(t('files.renamed'))
      refresh()
    },
    onError: (err) => toast.error(err.message),
  })

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => createFolder(name, folder),
    onSuccess: () => {
      setNewFolderMode(false)
      toast.success(t('files.folderCreated'))
      refresh()
    },
    onError: (err) => toast.error(err.message),
  })

  function navigateToFolder(alias: string) {
    navigate({ to: '/files', search: { folder: alias } })
  }

  function handleUploadFiles(acceptedFiles: File[]) {
    for (const file of acceptedFiles) {
      const toastId = toast.loading(t('files.uploading', { name: file.name }))
      uploadFile(file, folder, (percent) => {
        toast.loading(t('files.uploadProgress', { name: file.name, percent }), { id: toastId })
      })
        .then(() => {
          toast.success(t('files.uploadSuccess', { name: file.name }), { id: toastId })
          refresh()
        })
        .catch((err) => {
          toast.error(t('files.uploadFailed', { name: file.name, error: err.message }), {
            id: toastId,
          })
        })
    }
  }

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openFilePicker,
  } = useDropzone({
    onDrop: handleUploadFiles,
    noClick: true,
  })

  const breadcrumbs = buildBreadcrumbs(folder, items)

  if (objectsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div {...getRootProps()} className="relative min-h-[60vh]">
      <input {...getInputProps()} />

      {/* Drag overlay */}
      {isDragActive && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-primary/5">
          <Upload className="h-10 w-10 text-primary" />
          <p className="text-sm font-medium text-primary">{t('files.dropToUpload')}</p>
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <Breadcrumb crumbs={breadcrumbs} onNavigate={navigateToFolder} />
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setNewFolderMode(true)}>
            <FolderPlus className="mr-2 h-4 w-4" />
            {t('files.newFolder')}
          </Button>
          <Button size="sm" onClick={openFilePicker}>
            <Upload className="mr-2 h-4 w-4" />
            {t('files.upload')}
          </Button>
          <div className="ml-2 flex rounded-md border">
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="icon-xs"
              onClick={() => setViewMode('list')}
              title={t('files.listView')}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="icon-xs"
              onClick={() => setViewMode('grid')}
              title={t('files.gridView')}
            >
              <Grid className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* New folder inline input */}
      {newFolderMode && (
        <NewFolderInput
          onSubmit={(name) => createFolderMutation.mutate(name)}
          onCancel={() => setNewFolderMode(false)}
          isPending={createFolderMutation.isPending}
        />
      )}

      {/* File list */}
      {sorted.length === 0 && !newFolderMode ? (
        <EmptyState />
      ) : viewMode === 'list' ? (
        <FileListView
          items={sorted}
          renamingId={renamingId}
          onOpen={(item) => {
            if (item.dirtype !== DirType.FILE) navigateToFolder(item.alias)
            else downloadFile(item.id)
          }}
          onRename={(id, name) => renameMutation.mutate({ id, name })}
          onStartRename={setRenamingId}
          onCancelRename={() => setRenamingId(null)}
          onTrash={(id) => trashMutation.mutate([id])}
          onCopy={(id) => copyMutation.mutate({ id, parent: folder })}
          onDownload={(id) => downloadFile(id)}
        />
      ) : (
        <FileGridView
          items={sorted}
          onOpen={(item) => {
            if (item.dirtype !== DirType.FILE) navigateToFolder(item.alias)
            else downloadFile(item.id)
          }}
          onTrash={(id) => trashMutation.mutate([id])}
          onCopy={(id) => copyMutation.mutate({ id, parent: folder })}
          onDownload={(id) => downloadFile(id)}
          onStartRename={setRenamingId}
        />
      )}
    </div>
  )
}

/* ── Breadcrumb ── */

interface BreadcrumbItem {
  label: string
  alias: string
}

function buildBreadcrumbs(_currentFolder: string, _items: StorageObject[]): BreadcrumbItem[] {
  // Root is always first
  const crumbs: BreadcrumbItem[] = [{ label: 'Files', alias: '' }]
  // TODO: build full path from API when parent chain is available
  if (_currentFolder) {
    crumbs.push({ label: _currentFolder, alias: _currentFolder })
  }
  return crumbs
}

function Breadcrumb({ crumbs, onNavigate }: { crumbs: BreadcrumbItem[]; onNavigate: (alias: string) => void }) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      {crumbs.map((crumb, i) => (
        <span key={crumb.alias} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          {i < crumbs.length - 1 ? (
            <button
              type="button"
              onClick={() => onNavigate(crumb.alias)}
              className="text-muted-foreground hover:text-foreground"
            >
              {crumb.label}
            </button>
          ) : (
            <span className="font-medium">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

/* ── Empty state ── */

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <FolderOpen className="h-16 w-16" />
      <p className="text-sm">{t('files.emptyFolder')}</p>
    </div>
  )
}

/* ── New folder input ── */

function NewFolderInput({
  onSubmit,
  onCancel,
  isPending,
}: {
  onSubmit: (name: string) => void
  onCancel: () => void
  isPending: boolean
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const name = inputRef.current?.value.trim()
      if (name) onSubmit(name)
    }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="mb-2 flex items-center gap-2 rounded-md border px-3 py-2">
      <Folder className="h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        autoFocus
        placeholder={t('files.folderNamePlaceholder')}
        className="h-7 border-0 p-0 shadow-none focus-visible:ring-0"
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        disabled={isPending}
      />
    </div>
  )
}

/* ── List view ── */

function FileListView({
  items,
  renamingId,
  onOpen,
  onRename,
  onStartRename,
  onCancelRename,
  onTrash,
  onCopy,
  onDownload,
}: {
  items: StorageObject[]
  renamingId: string | null
  onOpen: (item: StorageObject) => void
  onRename: (id: string, name: string) => void
  onStartRename: (id: string) => void
  onCancelRename: () => void
  onTrash: (id: string) => void
  onCopy: (id: string) => void
  onDownload: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">{t('files.colName')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('files.colSize')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('files.colModified')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('files.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <FileListRow
              key={item.id}
              item={item}
              isRenaming={renamingId === item.id}
              onOpen={() => onOpen(item)}
              onRename={(name) => onRename(item.id, name)}
              onStartRename={() => onStartRename(item.id)}
              onCancelRename={onCancelRename}
              onTrash={() => onTrash(item.id)}
              onCopy={() => onCopy(item.id)}
              onDownload={() => onDownload(item.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FileListRow({
  item,
  isRenaming,
  onOpen,
  onRename,
  onStartRename,
  onCancelRename,
  onTrash,
  onCopy,
  onDownload,
}: {
  item: StorageObject
  isRenaming: boolean
  onOpen: () => void
  onRename: (name: string) => void
  onStartRename: () => void
  onCancelRename: () => void
  onTrash: () => void
  onCopy: () => void
  onDownload: () => void
}) {
  const isFolder = item.dirtype !== DirType.FILE
  const Icon = isFolder ? Folder : File

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          {isRenaming ? (
            <RenameInput defaultValue={item.name} onSubmit={onRename} onCancel={onCancelRename} />
          ) : (
            <button type="button" onClick={onOpen} className="truncate text-left hover:underline">
              {item.name}
            </button>
          )}
        </div>
      </td>
      <td className="px-4 py-2 text-muted-foreground">{isFolder ? '—' : formatSize(item.size)}</td>
      <td className="px-4 py-2 text-muted-foreground">{formatDate(item.updatedAt)}</td>
      <td className="px-4 py-2">
        <div className="flex justify-end">
          <ItemContextMenu
            isFolder={isFolder}
            onOpen={onOpen}
            onRename={onStartRename}
            onTrash={onTrash}
            onCopy={onCopy}
            onDownload={onDownload}
          />
        </div>
      </td>
    </tr>
  )
}

/* ── Grid view ── */

function FileGridView({
  items,
  onOpen,
  onTrash,
  onCopy,
  onDownload,
  onStartRename,
}: {
  items: StorageObject[]
  onOpen: (item: StorageObject) => void
  onTrash: (id: string) => void
  onCopy: (id: string) => void
  onDownload: (id: string) => void
  onStartRename: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {items.map((item) => {
        const isFolder = item.dirtype !== DirType.FILE
        const Icon = isFolder ? Folder : File
        return (
          <div
            key={item.id}
            className="group relative flex flex-col items-center gap-2 rounded-lg border p-4 hover:bg-muted/30"
          >
            <button type="button" onClick={() => onOpen(item)} className="flex flex-col items-center gap-2">
              <Icon className="h-10 w-10 text-muted-foreground" />
              <span className="max-w-full truncate text-xs">{item.name}</span>
            </button>
            <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100">
              <ItemContextMenu
                isFolder={isFolder}
                onOpen={() => onOpen(item)}
                onRename={() => onStartRename(item.id)}
                onTrash={() => onTrash(item.id)}
                onCopy={() => onCopy(item.id)}
                onDownload={() => onDownload(item.id)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Context menu ── */

function ItemContextMenu({
  isFolder,
  onOpen,
  onRename,
  onTrash,
  onCopy,
  onDownload,
}: {
  isFolder: boolean
  onOpen: () => void
  onRename: () => void
  onTrash: () => void
  onCopy: () => void
  onDownload: () => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onOpen}>
          <FolderOpen className="mr-2 h-4 w-4" />
          {t('files.open')}
        </DropdownMenuItem>
        {!isFolder && (
          <DropdownMenuItem onClick={onDownload}>
            <Download className="mr-2 h-4 w-4" />
            {t('files.download')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="mr-2 h-4 w-4" />
          {t('files.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCopy}>
          <Copy className="mr-2 h-4 w-4" />
          {t('files.copy')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onTrash}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t('files.moveToTrash')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ── Rename input ── */

function RenameInput({
  defaultValue,
  onSubmit,
  onCancel,
}: {
  defaultValue: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const name = inputRef.current?.value.trim()
      if (name && name !== defaultValue) onSubmit(name)
      else onCancel()
    }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <Input
      ref={inputRef}
      autoFocus
      defaultValue={defaultValue}
      className="h-6 px-1 text-sm"
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
    />
  )
}

/* ── Helpers ── */

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
