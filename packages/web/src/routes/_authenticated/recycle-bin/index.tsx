import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { StorageObject } from '@zpan/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useObjects } from '@/features/files/api'
import { formatFileSize, formatDate } from '@/features/files/utils'
import { useRestoreObject, usePermanentlyDeleteObject, useEmptyTrash } from '@/features/trash/api'
import { TrashToolbar } from '@/features/trash/components/trash-toolbar'
import { TrashList } from '@/features/trash/components/trash-list'

export const Route = createFileRoute('/_authenticated/recycle-bin/')({
  component: RecycleBinPage,
})

function RecycleBinPage() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pageSize, setPageSize] = useState(50)
  const [propertiesItem, setPropertiesItem] = useState<StorageObject | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<StorageObject | null>(null)
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)

  const { data, isLoading } = useObjects({ status: 'trashed', pageSize })
  const items = data?.items ?? []
  const total = data?.total ?? 0

  const restoreObject = useRestoreObject()
  const deleteObject = usePermanentlyDeleteObject()
  const emptyTrash = useEmptyTrash()

  function handleRestore(item: StorageObject) {
    restoreObject.mutate(item.id, {
      onSuccess: () => {
        toast.success(`"${item.name}" restored`)
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
      },
      onError: (err) => toast.error(err.message),
    })
  }

  function handleDeleteForever() {
    if (!confirmDelete) return
    deleteObject.mutate(confirmDelete.id, {
      onSuccess: () => {
        toast.success(`"${confirmDelete.name}" permanently deleted`)
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(confirmDelete.id)
          return next
        })
        setConfirmDelete(null)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  async function handleBatchRestore() {
    const ids = Array.from(selectedIds)
    const results = await Promise.allSettled(ids.map((id) => restoreObject.mutateAsync(id)))
    const failedIds = ids.filter((_, i) => results[i].status === 'rejected')
    const succeeded = ids.length - failedIds.length
    setSelectedIds(new Set(failedIds))
    if (succeeded > 0) toast.success(`${succeeded} item(s) restored`)
    if (failedIds.length > 0) toast.error(`Failed to restore ${failedIds.length} item(s)`)
  }

  async function handleBatchDelete() {
    const ids = Array.from(selectedIds)
    setConfirmBatchDelete(false)
    const results = await Promise.allSettled(ids.map((id) => deleteObject.mutateAsync(id)))
    const failedIds = ids.filter((_, i) => results[i].status === 'rejected')
    const succeeded = ids.length - failedIds.length
    setSelectedIds(new Set(failedIds))
    if (succeeded > 0) toast.success(`${succeeded} item(s) permanently deleted`)
    if (failedIds.length > 0) toast.error(`Failed to delete ${failedIds.length} item(s)`)
  }

  function handleEmptyTrash() {
    emptyTrash.mutate(undefined, {
      onSuccess: () => {
        toast.success('Trash emptied')
        setSelectedIds(new Set())
        setConfirmEmptyTrash(false)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <TrashToolbar
        selectedCount={selectedIds.size}
        totalCount={total}
        onBatchRestore={handleBatchRestore}
        onBatchDelete={() => setConfirmBatchDelete(true)}
        onEmptyTrash={() => setConfirmEmptyTrash(true)}
      />

      <TrashList
        items={items}
        total={total}
        isLoading={isLoading}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onRestore={handleRestore}
        onDeleteForever={setConfirmDelete}
        onProperties={setPropertiesItem}
        onLoadMore={() => setPageSize((s) => s + 50)}
      />

      {/* Single item delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Forever</DialogTitle>
            <DialogDescription>
              "{confirmDelete?.name}" will be permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteForever}>
              Delete Forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch delete confirmation */}
      <Dialog open={confirmBatchDelete} onOpenChange={setConfirmBatchDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Forever</DialogTitle>
            <DialogDescription>
              {selectedIds.size} item(s) will be permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBatchDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBatchDelete}>
              Delete Forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Empty trash confirmation */}
      <Dialog open={confirmEmptyTrash} onOpenChange={setConfirmEmptyTrash}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Empty Trash</DialogTitle>
            <DialogDescription>
              All items in the trash will be permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEmptyTrash(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleEmptyTrash}>
              Empty Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
