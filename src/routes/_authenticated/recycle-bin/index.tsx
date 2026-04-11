import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { TrashList } from '@/components/trash/trash-list'
import { TrashToolbar } from '@/components/trash/trash-toolbar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { deleteObject, emptyTrash, listObjects, restoreObject } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/recycle-bin/')({
  component: RecycleBinPage,
})

const QUERY_KEY = ['objects', 'trashed']
const PAGE_SIZE = 20

function RecycleBinPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDialog, setConfirmDialog] = useState<'delete' | 'empty' | null>(null)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([])

  const trashQuery = useQuery({
    queryKey: [...QUERY_KEY, page, PAGE_SIZE],
    queryFn: () => listObjects('', 'trashed', page, PAGE_SIZE),
  })

  const restoreMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => restoreObject(id)))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      setSelectedIds(new Set())
      toast.success(t('recycleBin.restoreSuccess'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteObject(id)))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      setSelectedIds(new Set())
      setConfirmDialog(null)
      setPendingDeleteIds([])
      toast.success(t('recycleBin.deleteSuccess'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const emptyTrashMutation = useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      setSelectedIds(new Set())
      setConfirmDialog(null)
      toast.success(t('recycleBin.emptySuccess'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const items = trashQuery.data?.items ?? []
  const total = trashQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleToggleSelectAll() {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map((item) => item.id)))
    }
  }

  function handleDeleteSelected() {
    setPendingDeleteIds([...selectedIds])
    setConfirmDialog('delete')
  }

  function handleDeleteSingle(id: string) {
    setPendingDeleteIds([id])
    setConfirmDialog('delete')
  }

  if (trashQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <TrashToolbar
        selectedCount={selectedIds.size}
        hasItems={items.length > 0}
        onRestore={() => restoreMutation.mutate([...selectedIds])}
        onDeletePermanently={handleDeleteSelected}
        onEmptyTrash={() => setConfirmDialog('empty')}
        isRestoring={restoreMutation.isPending}
        isDeleting={deleteMutation.isPending}
        isEmptying={emptyTrashMutation.isPending}
      />

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
          <Trash2 className="h-16 w-16" />
          <p className="text-sm">{t('recycleBin.placeholder')}</p>
        </div>
      ) : (
        <>
          <TrashList
            items={items}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            onRestore={(id) => restoreMutation.mutate([id])}
            onDeletePermanently={handleDeleteSingle}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('recycleBin.prevPage')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('recycleBin.pageInfo', { page, total: totalPages })}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                {t('recycleBin.nextPage')}
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={confirmDialog === 'delete'} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('recycleBin.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('recycleBin.confirmDelete', { count: pendingDeleteIds.length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate(pendingDeleteIds)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? t('common.loading') : t('recycleBin.deletePermanently')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDialog === 'empty'} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('recycleBin.emptyTitle')}</DialogTitle>
            <DialogDescription>{t('recycleBin.confirmEmpty')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => emptyTrashMutation.mutate()}
              disabled={emptyTrashMutation.isPending}
            >
              {emptyTrashMutation.isPending ? t('common.loading') : t('recycleBin.empty')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
