import { useState, useRef, useCallback } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { StorageObject } from '@zpan/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { Home, Folder } from 'lucide-react'
import {
  useObjects,
  useCreateObject,
  useUpdateObject,
  useTrashObject,
  useCopyObject,
} from '@/features/files/api'
import { formatFileSize, formatDate, isFolder } from '@/features/files/utils'
import { BreadcrumbNav } from '@/features/files/components/breadcrumb-nav'
import { FileToolbar } from '@/features/files/components/file-toolbar'
import { FileList } from '@/features/files/components/file-list'
import { FileUpload } from '@/features/files/components/file-upload'
import { FilePreview } from '@/features/files/components/file-preview'

interface FileSearch {
  parent?: string
  type?: string
  search?: string
}

export const Route = createFileRoute('/_authenticated/files/')({
  validateSearch: (search: Record<string, unknown>): FileSearch => ({
    parent: (search.parent as string) || undefined,
    type: (search.type as string) || undefined,
    search: (search.search as string) || undefined,
  }),
  component: FilesPage,
})

function FilesPage() {
  const navigate = useNavigate()
  const { parent, type, search: searchParam } = useSearch({ from: '/_authenticated/files/' })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchLocal, setSearchLocal] = useState(searchParam ?? '')
  const [previewItem, setPreviewItem] = useState<StorageObject | null>(null)
  const [renameItem, setRenameItem] = useState<StorageObject | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [propertiesItem, setPropertiesItem] = useState<StorageObject | null>(null)
  const [moveItem, setMoveItem] = useState<StorageObject | null>(null)
  const [copyItem, setCopyItem] = useState<StorageObject | null>(null)
  const [folderTargetId, setFolderTargetId] = useState('')

  // Breadcrumb path state — track ancestors as user navigates
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([])
  const [pageSize, setPageSize] = useState(50)

  const listParams = {
    parent: type ? undefined : (parent ?? ''),
    status: 'active',
    type,
    search: searchLocal || undefined,
    pageSize,
  }
  const { data, isLoading } = useObjects(listParams)
  const items = data?.items ?? []
  const total = data?.total ?? 0

  const createObject = useCreateObject()
  const updateObject = useUpdateObject()
  const trashObject = useTrashObject()
  const copyObject = useCopyObject()

  const navigateToFolder = useCallback(
    (folderId: string, folderName?: string) => {
      setSelectedIds(new Set())
      if (folderId === '') {
        setBreadcrumbs([])
      } else if (folderName) {
        // Going deeper — append
        setBreadcrumbs((prev) => {
          const idx = prev.findIndex((b) => b.id === folderId)
          if (idx >= 0) return prev.slice(0, idx + 1)
          return [...prev, { id: folderId, name: folderName }]
        })
      } else {
        // Clicking breadcrumb — trim
        setBreadcrumbs((prev) => {
          const idx = prev.findIndex((b) => b.id === folderId)
          return idx >= 0 ? prev.slice(0, idx + 1) : prev
        })
      }
      navigate({ to: '/files', search: { parent: folderId || undefined, type } })
    },
    [navigate, type],
  )

  function handleNavigate(item: StorageObject) {
    if (isFolder(item)) navigateToFolder(item.id, item.name)
  }

  function handleCreateFolder(name: string) {
    createObject.mutate(
      { name, type: '', dirtype: 1, parent: parent ?? '' },
      {
        onSuccess: () => toast.success(`Created folder "${name}"`),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function handleRenameSubmit() {
    if (!renameItem || !renameValue.trim()) return
    updateObject.mutate(
      { id: renameItem.id, name: renameValue.trim() },
      {
        onSuccess: () => {
          toast.success('Renamed successfully')
          setRenameItem(null)
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function handleTrash(item: StorageObject) {
    trashObject.mutate(item.id, {
      onSuccess: () => toast.success(`"${item.name}" moved to trash`),
      onError: (err) => toast.error(err.message),
    })
  }

  async function handleBatchTrash() {
    const ids = Array.from(selectedIds)
    setSelectedIds(new Set())
    const results = await Promise.allSettled(ids.map((id) => trashObject.mutateAsync(id)))
    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.length - succeeded
    if (succeeded > 0) toast.success(`${succeeded} item(s) moved to trash`)
    if (failed > 0) toast.error(`Failed to trash ${failed} item(s)`)
  }

  async function handleDownload(item: StorageObject) {
    try {
      const res = await fetch(`/api/objects/${item.id}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`)
      const data: { downloadUrl?: string } = await res.json()
      if (data.downloadUrl) {
        window.open(data.downloadUrl, '_blank')
      } else {
        toast.error('Download URL not available')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    }
  }

  function handleMoveSubmit() {
    if (!moveItem) return
    updateObject.mutate(
      { id: moveItem.id, parent: folderTargetId },
      {
        onSuccess: () => {
          toast.success('Moved successfully')
          setMoveItem(null)
          setFolderTargetId('')
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function handleCopySubmit() {
    if (!copyItem) return
    copyObject.mutate(
      { id: copyItem.id, parent: folderTargetId },
      {
        onSuccess: () => {
          toast.success('Copied successfully')
          setCopyItem(null)
          setFolderTargetId('')
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function openRename(item: StorageObject) {
    setRenameItem(item)
    setRenameValue(item.name)
  }

  return (
    <div className="flex flex-col gap-4">
      <BreadcrumbNav
        path={breadcrumbs}
        typeFilter={type}
        onNavigate={(id) => navigateToFolder(id)}
      />

      <FileToolbar
        search={searchLocal}
        onSearchChange={setSearchLocal}
        onUploadClick={() => fileInputRef.current?.click()}
        onCreateFolder={handleCreateFolder}
        selectedCount={selectedIds.size}
        onBatchTrash={handleBatchTrash}
      />

      <FileUpload parent={parent ?? ''} inputRef={fileInputRef} />

      <FileList
        items={items}
        total={total}
        isLoading={isLoading}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onNavigate={(id: string) => {
          const item = items.find((i: StorageObject) => i.id === id)
          if (item) handleNavigate(item)
        }}
        onPreview={setPreviewItem}
        onRename={openRename}
        onMove={(item) => {
          setMoveItem(item)
          setFolderTargetId('')
        }}
        onCopy={(item) => {
          setCopyItem(item)
          setFolderTargetId('')
        }}
        onTrash={handleTrash}
        onDownload={handleDownload}
        onProperties={setPropertiesItem}
        onLoadMore={() => setPageSize((s) => s + 50)}
      />

      {/* Preview Dialog */}
      <FilePreview
        item={previewItem}
        open={!!previewItem}
        onOpenChange={(open) => !open && setPreviewItem(null)}
      />

      {/* Rename Dialog */}
      <Dialog open={!!renameItem} onOpenChange={(open) => !open && setRenameItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameItem(null)}>
              Cancel
            </Button>
            <Button onClick={handleRenameSubmit} disabled={!renameValue.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Dialog */}
      <FolderPickerDialog
        open={!!moveItem}
        title="Move to"
        onOpenChange={(open) => !open && setMoveItem(null)}
        folderTargetId={folderTargetId}
        onFolderTargetChange={setFolderTargetId}
        onSubmit={handleMoveSubmit}
      />

      {/* Copy Dialog */}
      <FolderPickerDialog
        open={!!copyItem}
        title="Copy to"
        onOpenChange={(open) => !open && setCopyItem(null)}
        folderTargetId={folderTargetId}
        onFolderTargetChange={setFolderTargetId}
        onSubmit={handleCopySubmit}
      />

      {/* Properties Sheet */}
      <Sheet open={!!propertiesItem} onOpenChange={(open) => !open && setPropertiesItem(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Properties</SheetTitle>
          </SheetHeader>
          {propertiesItem && <PropertiesPanel item={propertiesItem} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function FolderPickerDialog({
  open,
  title,
  onOpenChange,
  folderTargetId,
  onFolderTargetChange,
  onSubmit,
}: {
  open: boolean
  title: string
  onOpenChange: (open: boolean) => void
  folderTargetId: string
  onFolderTargetChange: (id: string) => void
  onSubmit: () => void
}) {
  const [browsing, setBrowsing] = useState('')
  const { data } = useObjects({
    parent: browsing,
    status: 'active',
    pageSize: 100,
  })
  const folders = (data?.items ?? []).filter((i: StorageObject) => i.dirtype > 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setBrowsing('')
        onOpenChange(v)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-60 overflow-y-auto rounded-md border">
          <button
            type="button"
            onClick={() => {
              onFolderTargetChange('')
              setBrowsing('')
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors',
              folderTargetId === '' && 'bg-muted font-medium',
            )}
          >
            <Home className="h-4 w-4" />
            Root (My Files)
          </button>
          {folders.map((f: StorageObject) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFolderTargetChange(f.id)}
              onDoubleClick={() => setBrowsing(f.id)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors',
                folderTargetId === f.id && 'bg-muted font-medium',
              )}
            >
              <Folder className="h-4 w-4 text-blue-500" />
              {f.name}
            </button>
          ))}
          {folders.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">No subfolders</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit}>{title}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PropertiesPanel({ item }: { item: StorageObject }) {
  const rows = [
    ['Name', item.name],
    ['Type', item.type || 'Folder'],
    ['Size', formatFileSize(item.size)],
    ['Created', formatDate(item.createdAt)],
    ['Modified', formatDate(item.updatedAt)],
    ['ID', item.id],
    ['Alias', item.alias],
  ]

  return (
    <dl className="mt-4 space-y-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm break-all">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
