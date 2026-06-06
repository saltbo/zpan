import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { NameConflictDialog } from '@/components/files/dialogs/name-conflict-dialog'
import { OperationProgress, type OperationProgressState } from '@/components/files/dialogs/operation-progress'
import { useConflictResolver, withConflictRetry } from '@/components/files/hooks/use-conflict-resolver'
import { PageHeader } from '@/components/layout/page-header'
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
import { runSequentialOperation } from '@/lib/sequential-operation'

export const Route = createFileRoute('/_authenticated/trash/')({
  component: TrashPage,
})

const QUERY_KEY = ['objects', 'trashed']
const PAGE_SIZE = 20

function TrashPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDialog, setConfirmDialog] = useState<'delete' | 'empty' | null>(null)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([])
  const operationCancelRef = useRef(false)
  const [operationState, setOperationState] = useState<OperationProgressState | null>(null)
  const conflict = useConflictResolver()

  const trashQuery = useQuery({
    queryKey: [...QUERY_KEY, page, PAGE_SIZE],
    queryFn: () => listObjects('', 'trashed', page, PAGE_SIZE),
  })

  async function runTrashPageOperation(
    title: string,
    ids: string[],
    runItem: (id: string) => Promise<unknown>,
  ): Promise<void> {
    operationCancelRef.current = false
    const namesById = new Map(items.map((item) => [item.id, item.name]))
    setOperationState({ title, total: ids.length, completed: 0, currentName: '', cancelRequested: false })

    const result = await runSequentialOperation({
      items: ids,
      shouldCancel: () => operationCancelRef.current,
      onItemStart: (id) => {
        setOperationState((state) => (state ? { ...state, currentName: namesById.get(id) ?? id } : state))
      },
      onItemComplete: (_id, index) => {
        setOperationState((state) => (state ? { ...state, completed: index + 1 } : state))
      },
      onItemFailure: (_id, _error, index) => {
        setOperationState((state) => (state ? { ...state, completed: index + 1 } : state))
      },
      runItem,
    })

    setOperationState(null)
    if (result.failed.length > 0) {
      throw new Error(t('files.operationFailedSummary', { failed: result.failed.length, total: ids.length }))
    }
    if (result.cancelled) {
      toast.info(t('files.operationCancelled', { completed: result.completed, total: ids.length }))
    }
  }

  function requestOperationCancel() {
    operationCancelRef.current = true
    setOperationState((state) => (state ? { ...state, cancelRequested: true } : state))
  }

  async function runRestore(ids: string[]) {
    conflict.reset()
    const showApplyToAll = ids.length > 1
    await runTrashPageOperation(t('trash.restore'), ids, async (id) => {
      const restored = await withConflictRetry(conflict.prompt, 'file', (strategy) => restoreObject(id, strategy), {
        showApplyToAll,
      })
      if (!restored) operationCancelRef.current = true
    })
  }

  const restoreMutation = useMutation({
    mutationFn: runRestore,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      setSelectedIds(new Set())
      toast.success(t('trash.restoreSuccess'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await runTrashPageOperation(t('trash.deletePermanently'), ids, (id) => deleteObject(id))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      setSelectedIds(new Set())
      setConfirmDialog(null)
      setPendingDeleteIds([])
      toast.success(t('trash.deleteSuccess'))
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
      toast.success(t('trash.emptySuccess'))
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
      <PageHeader
        items={[
          {
            label: t('trash.title'),
            icon: <Trash2 className="size-4 text-muted-foreground" />,
          },
        ]}
        actions={
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmDialog('empty')}
            disabled={items.length === 0 || emptyTrashMutation.isPending}
          >
            <Trash2 />
            <span className="sr-only sm:not-sr-only">{t('trash.empty')}</span>
          </Button>
        }
      />

      <TrashToolbar
        selectedCount={selectedIds.size}
        onRestore={() => restoreMutation.mutate([...selectedIds])}
        onDeletePermanently={handleDeleteSelected}
        isRestoring={restoreMutation.isPending}
        isDeleting={deleteMutation.isPending}
      />

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
          <Trash2 className="h-16 w-16" />
          <p className="text-sm">{t('trash.placeholder')}</p>
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
                {t('trash.prevPage')}
              </Button>
              <span className="text-sm text-muted-foreground">{t('trash.pageInfo', { page, total: totalPages })}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                {t('trash.nextPage')}
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog
        open={confirmDialog === 'delete'}
        onOpenChange={(open) => {
          if (!open && operationState) {
            requestOperationCancel()
            return
          }
          if (!open) setConfirmDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('trash.deleteTitle')}</DialogTitle>
            {!operationState && (
              <DialogDescription>{t('trash.confirmDelete', { count: pendingDeleteIds.length })}</DialogDescription>
            )}
          </DialogHeader>
          {operationState ? (
            <OperationProgress operation={operationState} onCancel={requestOperationCancel} />
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialog(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(pendingDeleteIds)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? t('common.loading') : t('trash.deletePermanently')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!operationState && confirmDialog !== 'delete'}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{operationState?.title}</DialogTitle>
          </DialogHeader>
          {operationState && <OperationProgress operation={operationState} onCancel={requestOperationCancel} />}
        </DialogContent>
      </Dialog>

      <NameConflictDialog {...conflict.dialogState} />

      <Dialog open={confirmDialog === 'empty'} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('trash.emptyTitle')}</DialogTitle>
            <DialogDescription>{t('trash.confirmEmpty')}</DialogDescription>
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
              {emptyTrashMutation.isPending ? t('common.loading') : t('trash.empty')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
