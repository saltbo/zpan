import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface DeleteStorageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storage: { id: string; title: string } | null
}

export function DeleteStorageDialog({ open, onOpenChange, storage }: DeleteStorageDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/storages/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.status === 409) {
        throw new Error(t('admin.storages.deleteHasFiles'))
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message ?? 'Failed to delete storage')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'storages'] })
      onOpenChange(false)
      toast.success(t('admin.storages.deleted'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  if (!storage) return null

  function handleDelete() {
    mutation.mutate(storage!.id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.storages.deleteTitle')}</DialogTitle>
          <DialogDescription>{t('admin.storages.deleteConfirm', { title: storage.title })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={mutation.isPending}>
            {mutation.isPending ? t('common.loading') : t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
