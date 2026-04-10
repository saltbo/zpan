import type { Storage } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Database, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeleteStorageDialog } from '@/components/admin/delete-storage-dialog'
import { StorageFormDialog } from '@/components/admin/storage-form-dialog'
import { Button } from '@/components/ui/button'
import { listStorages } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/storages/')({
  component: StoragesPage,
})

import { StorageStatus } from '@shared/constants'

function StoragesPage() {
  const { t } = useTranslation()
  const [formOpen, setFormOpen] = useState(false)
  const [editingStorage, setEditingStorage] = useState<Storage | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const storagesQuery = useQuery({
    queryKey: ['admin', 'storages'],
    queryFn: listStorages,
  })

  const storages = storagesQuery.data?.items ?? []

  function handleEdit(storage: Storage) {
    setEditingStorage(storage)
    setFormOpen(true)
  }

  function handleAddNew() {
    setEditingStorage(null)
    setFormOpen(true)
  }

  function handleFormOpenChange(open: boolean) {
    setFormOpen(open)
    if (!open) setEditingStorage(null)
  }

  if (storagesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t('admin.storages.title')}</h2>
        <Button size="sm" onClick={handleAddNew}>
          <Plus className="mr-2 h-4 w-4" />
          {t('admin.storages.add')}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colTitle')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colMode')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colBucket')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colEndpoint')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colStatus')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('admin.storages.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {storages.map((storage) => (
              <StorageTableRow
                key={storage.id}
                storage={storage}
                onEdit={() => handleEdit(storage)}
                onDelete={() => setDeleteTarget({ id: storage.id, title: storage.title })}
              />
            ))}
            {storages.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-3">
                    <Database className="h-10 w-10" />
                    <p>{t('admin.storages.noStorages')}</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <StorageFormDialog open={formOpen} onOpenChange={handleFormOpenChange} storage={editingStorage} />

      <DeleteStorageDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        storage={deleteTarget}
      />
    </div>
  )
}

function StorageTableRow({
  storage,
  onEdit,
  onDelete,
}: {
  storage: Storage
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  const isActive = storage.status === StorageStatus.ACTIVE

  const modeBadge =
    storage.mode === 'public' ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-primary/10 text-primary'

  const statusBadge = isActive ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground'

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 font-medium">{storage.title}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${modeBadge}`}>
          {storage.mode === 'public' ? t('admin.storages.modePublic') : t('admin.storages.modePrivate')}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{storage.bucket}</td>
      <td className="max-w-48 truncate px-4 py-3 text-muted-foreground">{storage.endpoint}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge}`}>
          {isActive ? t('admin.storages.statusActive') : t('admin.storages.statusInactive')}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon-xs" onClick={onEdit} title={t('common.edit')}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onDelete} title={t('common.delete')}>
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </td>
    </tr>
  )
}
