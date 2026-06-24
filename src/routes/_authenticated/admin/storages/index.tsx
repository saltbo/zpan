import { FREE_STORAGE_LIMIT, StorageStatus } from '@shared/constants'
import type { Storage } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Database, Loader2, Pencil, Plus, TestTube2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeleteStorageDialog } from '@/components/admin/delete-storage-dialog'
import { StorageFormDrawer } from '@/components/admin/storage-form-drawer'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import { useEntitlement } from '@/hooks/useEntitlement'
import { ApiError, abortObjectUpload, createObject, listStorages } from '@/lib/api'
import { formatSize } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/admin/storages/')({
  component: StoragesPage,
})

type StorageHealth =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }
  | { status: 'cors'; message: string; corsJson: string }

const TEST_CONTENT = 'zpan storage connection test\n'

export function corsJsonForOrigin(origin: string) {
  return JSON.stringify(
    [
      {
        AllowedOrigins: [origin],
        AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3600,
      },
    ],
    null,
    2,
  )
}

function readableError(error: unknown) {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

export function StoragesPage() {
  const { t } = useTranslation()
  const { hasFeature } = useEntitlement()
  const [formOpen, setFormOpen] = useState(false)
  const [editingStorage, setEditingStorage] = useState<Storage | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [healthByStorage, setHealthByStorage] = useState<Record<string, StorageHealth>>({})

  const storagesQuery = useQuery({
    queryKey: ['admin', 'storages'],
    queryFn: listStorages,
  })

  const storages = storagesQuery.data?.items ?? []
  const storagesLimitReached = !hasFeature('storages_unlimited') && storages.length >= FREE_STORAGE_LIMIT
  const hasTrafficBilling = hasFeature('quota_store')

  function handleEdit(storage: Storage) {
    setEditingStorage(storage)
    setFormOpen(true)
  }

  function handleAddNew() {
    if (storagesLimitReached) return
    setEditingStorage(null)
    setFormOpen(true)
  }

  function handleFormOpenChange(open: boolean) {
    setFormOpen(open)
    if (!open) setEditingStorage(null)
  }

  async function handleTest(storage: Storage) {
    setHealthByStorage((current) => ({ ...current, [storage.id]: { status: 'testing' } }))
    let draft: { id: string; upload?: { sessionId: string; urls: string[] } } | null = null
    let result: StorageHealth | null = null

    try {
      const blob = new Blob([TEST_CONTENT], { type: 'text/plain' })
      draft = await createObject({
        name: `.zpan-storage-test-${Date.now()}.txt`,
        type: 'text/plain',
        size: blob.size,
        parent: '',
        dirtype: 0,
        storageId: storage.id,
      })
      const upload = draft.upload
      if (!upload?.urls[0]) throw new Error(t('admin.storages.testNoUploadUrl'))

      let uploadResponse: Response
      try {
        uploadResponse = await fetch(upload.urls[0], {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: blob,
        })
      } catch {
        result = {
          status: 'cors',
          message: t('admin.storages.testCorsFailure'),
          corsJson: corsJsonForOrigin(window.location.origin),
        }
        return
      }

      if (!uploadResponse.ok) {
        const body = await uploadResponse.text().catch(() => '')
        const detail = body.trim() || uploadResponse.statusText || `HTTP ${uploadResponse.status}`
        throw new Error(t('admin.storages.testUploadFailed', { detail }))
      }

      result = { status: 'success', message: t('admin.storages.testSuccess') }
    } catch (error) {
      result = { status: 'error', message: readableError(error) }
    } finally {
      if (draft?.upload) {
        try {
          await abortObjectUpload(draft.id, draft.upload.sessionId, { strictStorageCleanup: true })
        } catch (cleanupError) {
          const cleanupMessage = t('admin.storages.testCleanupFailed', { detail: readableError(cleanupError) })
          result =
            result?.status === 'success'
              ? { status: 'error', message: cleanupMessage }
              : result
                ? { ...result, message: `${result.message} ${cleanupMessage}` }
                : { status: 'error', message: cleanupMessage }
        }
      }
      setHealthByStorage((current) => ({ ...current, [storage.id]: result ?? { status: 'idle' } }))
    }
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
        <Button size="sm" onClick={handleAddNew} disabled={storagesLimitReached}>
          <Plus className="mr-2 h-4 w-4" />
          {t('admin.storages.add')}
        </Button>
      </div>

      {storagesLimitReached && <UpgradeHint feature="storages_unlimited" />}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colTitle')}</th>
              <th className="hidden px-4 py-3 text-left font-medium md:table-cell">{t('admin.storages.colBucket')}</th>
              <th className="hidden max-w-48 px-4 py-3 text-left font-medium lg:table-cell">
                {t('admin.storages.colEndpoint')}
              </th>
              <th className="hidden px-4 py-3 text-left font-medium lg:table-cell">
                {t('admin.storages.colEgressBilling')}
              </th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colStatus')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colHealth')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('admin.storages.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {storages.map((storage) => (
              <StorageTableRow
                key={storage.id}
                storage={storage}
                hasTrafficBilling={hasTrafficBilling}
                health={healthByStorage[storage.id] ?? { status: 'idle' }}
                onTest={() => handleTest(storage)}
                onEdit={() => handleEdit(storage)}
                onDelete={() => setDeleteTarget({ id: storage.id, title: storage.title })}
              />
            ))}
            {storages.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
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

      <StorageFormDrawer
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        storage={editingStorage}
        hasTrafficBilling={hasTrafficBilling}
      />

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
  hasTrafficBilling,
  health,
  onTest,
  onEdit,
  onDelete,
}: {
  storage: Storage
  hasTrafficBilling: boolean
  health: StorageHealth
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  const isActive = storage.status === StorageStatus.ACTIVE

  const statusBadge = isActive ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground'

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 font-medium">{storage.title}</td>
      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{storage.bucket}</td>
      <td className="hidden max-w-48 truncate px-4 py-3 text-muted-foreground lg:table-cell">{storage.endpoint}</td>
      <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
        {hasTrafficBilling && storage.egressCreditBillingEnabled
          ? t('admin.storages.egressBillingRate', {
              credits: storage.egressCreditPerUnit,
              unit: formatSize(storage.egressCreditUnitBytes),
            })
          : t('admin.storages.egressBillingOff')}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge}`}>
          {isActive ? t('admin.storages.statusActive') : t('admin.storages.statusInactive')}
        </span>
      </td>
      <td className="min-w-64 px-4 py-3">
        <StorageHealthView health={health} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onTest}
            title={t('admin.storages.testAction')}
            disabled={health.status === 'testing'}
          >
            {health.status === 'testing' ? <Loader2 className="animate-spin" /> : <TestTube2 />}
          </Button>
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

function StorageHealthView({ health }: { health: StorageHealth }) {
  const { t } = useTranslation()

  if (health.status === 'idle') {
    return <span className="text-xs text-muted-foreground">{t('admin.storages.healthUntested')}</span>
  }

  if (health.status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('admin.storages.healthTesting')}
      </span>
    )
  }

  if (health.status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" />
        {health.message}
      </span>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-1 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>{health.message}</span>
      </div>
      {health.status === 'cors' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('admin.storages.testCorsCaveat')}</p>
          <pre className="max-w-sm overflow-x-auto rounded border bg-muted p-2 text-xs text-muted-foreground">
            {health.corsJson}
          </pre>
        </div>
      )}
    </div>
  )
}
