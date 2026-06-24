import { FREE_STORAGE_LIMIT, StorageStatus } from '@shared/constants'
import type { Storage } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  Pencil,
  Plus,
  Settings2,
  TestTube2,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField } from '@/components/admin/admin-form-drawer'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { DeleteStorageDialog } from '@/components/admin/delete-storage-dialog'
import { StorageFormDrawer } from '@/components/admin/storage-form-drawer'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useEntitlement } from '@/hooks/useEntitlement'
import { ApiError, abortObjectUpload, createObject, listStorages, updateStorageEgressBilling } from '@/lib/api'
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
const CREDIT_UNITS = { MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 } as const

type CreditUnit = keyof typeof CREDIT_UNITS
type EgressBillingForm = {
  enabled: boolean
  unitValue: string
  unit: CreditUnit
  credits: string
}

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
  const queryClient = useQueryClient()
  const { hasFeature } = useEntitlement()
  const [formOpen, setFormOpen] = useState(false)
  const [editingStorage, setEditingStorage] = useState<Storage | null>(null)
  const [billingTarget, setBillingTarget] = useState<Storage | null>(null)
  const [billingForm, setBillingForm] = useState<EgressBillingForm>(emptyEgressBillingForm())
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [healthByStorage, setHealthByStorage] = useState<Record<string, StorageHealth>>({})

  const storagesQuery = useQuery({
    queryKey: ['admin', 'storages'],
    queryFn: listStorages,
  })

  const storages = storagesQuery.data?.items ?? []
  const storagesLimitReached = !hasFeature('storages_unlimited') && storages.length >= FREE_STORAGE_LIMIT
  const hasTrafficBilling = hasFeature('quota_store')

  const billingMutation = useMutation({
    mutationFn: ({ storage, form }: { storage: Storage; form: EgressBillingForm }) =>
      updateStorageEgressBilling(
        storage.id,
        egressBillingPayload(hasTrafficBilling ? form : { ...form, enabled: false }),
      ),
    onSuccess: () => {
      setBillingTarget(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'storages'] })
      toast.success(t('admin.storages.egressBillingSaveSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  function handleEdit(storage: Storage) {
    setEditingStorage(storage)
    setFormOpen(true)
  }

  function handleAddNew() {
    if (storagesLimitReached) return
    setEditingStorage(null)
    setFormOpen(true)
  }

  function handleConfigureBilling(storage: Storage) {
    setBillingTarget(storage)
    setBillingForm(egressBillingFormFromStorage(storage))
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
      <AdminPageHeader
        title={t('admin.storages.title')}
        action={
          <Button size="sm" onClick={handleAddNew} disabled={storagesLimitReached}>
            <Plus className="mr-2 h-4 w-4" />
            {t('admin.storages.add')}
          </Button>
        }
      />

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
                onConfigureBilling={() => handleConfigureBilling(storage)}
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

      <StorageFormDrawer open={formOpen} onOpenChange={handleFormOpenChange} storage={editingStorage} />

      <StorageEgressBillingDrawer
        storage={billingTarget}
        form={billingForm}
        open={billingTarget !== null}
        pending={billingMutation.isPending}
        hasTrafficBilling={hasTrafficBilling}
        onFormChange={setBillingForm}
        onOpenChange={(open) => !open && setBillingTarget(null)}
        onConfirm={() => billingTarget && billingMutation.mutate({ storage: billingTarget, form: billingForm })}
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
  onConfigureBilling,
  onDelete,
}: {
  storage: Storage
  hasTrafficBilling: boolean
  health: StorageHealth
  onTest: () => void
  onEdit: () => void
  onConfigureBilling: () => void
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
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onConfigureBilling}
            title={t('admin.storages.configureEgressBilling')}
          >
            <Settings2 />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onDelete} title={t('common.delete')}>
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function StorageEgressBillingDrawer({
  storage,
  form,
  open,
  pending,
  hasTrafficBilling,
  onFormChange,
  onOpenChange,
  onConfirm,
}: {
  storage: Storage | null
  form: EgressBillingForm
  open: boolean
  pending: boolean
  hasTrafficBilling: boolean
  onFormChange: (form: EgressBillingForm) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const valid = Number(form.unitValue) >= 1 && Number(form.credits) >= 1
  const canSave = hasTrafficBilling && valid

  return (
    <AdminFormDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.storages.egressBillingTitle')}
      description={t('admin.storages.egressBillingDescription', { title: storage?.title ?? '' })}
      bodyClassName="grid gap-4"
      formProps={{
        onSubmit: (event) => {
          event.preventDefault()
          if (canSave) onConfirm()
        },
      }}
      footer={
        hasTrafficBilling ? (
          <>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !canSave}>
              {pending ? t('common.loading') : t('common.save')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        )
      }
    >
      <div className="rounded-md border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="egressCreditBillingEnabled">{t('admin.storages.egressBilling')}</Label>
            <p className="text-xs text-muted-foreground">{t('admin.storages.egressBillingHint')}</p>
          </div>
          <Switch
            id="egressCreditBillingEnabled"
            disabled={!hasTrafficBilling}
            checked={form.enabled}
            onCheckedChange={(enabled) => onFormChange({ ...form, enabled: hasTrafficBilling && enabled })}
          />
        </div>
        {!hasTrafficBilling && (
          <p className="mt-2 text-xs text-muted-foreground">{t('admin.storages.egressBillingBusinessOnly')}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminFormField id="storage-egress-credit-unit-value" label={t('admin.storages.egressBillingUnit')}>
          {(controlProps) => (
            <div className="flex items-center gap-2">
              <Input
                {...controlProps}
                type="number"
                min={1}
                step={1}
                value={form.unitValue}
                disabled={!hasTrafficBilling}
                onChange={(event) => onFormChange({ ...form, unitValue: event.target.value })}
              />
              <Select value={form.unit} onValueChange={(unit) => onFormChange({ ...form, unit: unit as CreditUnit })}>
                <SelectTrigger className="w-24" disabled={!hasTrafficBilling}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MB">MB</SelectItem>
                  <SelectItem value="GB">GB</SelectItem>
                  <SelectItem value="TB">TB</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </AdminFormField>
        <AdminFormField id="storage-egress-credit-per-unit" label={t('admin.storages.egressBillingCredits')}>
          <Input
            type="number"
            min={1}
            step={1}
            value={form.credits}
            disabled={!hasTrafficBilling}
            onChange={(event) => onFormChange({ ...form, credits: event.target.value })}
          />
        </AdminFormField>
      </div>
    </AdminFormDrawer>
  )
}

function emptyEgressBillingForm(): EgressBillingForm {
  return { enabled: false, unitValue: '100', unit: 'MB', credits: '1' }
}

function egressBillingFormFromStorage(storage: Storage): EgressBillingForm {
  const unit = bytesToCreditUnit(storage.egressCreditUnitBytes)
  return {
    enabled: storage.egressCreditBillingEnabled,
    unitValue: String(Math.max(1, storage.egressCreditUnitBytes / CREDIT_UNITS[unit])),
    unit,
    credits: String(storage.egressCreditPerUnit),
  }
}

function egressBillingPayload(form: EgressBillingForm) {
  return {
    enabled: form.enabled,
    unitBytes: Math.max(1, Math.floor(Number(form.unitValue))) * CREDIT_UNITS[form.unit],
    creditsPerUnit: Math.max(1, Math.floor(Number(form.credits))),
  }
}

function bytesToCreditUnit(bytes: number): CreditUnit {
  if (bytes >= CREDIT_UNITS.TB && bytes % CREDIT_UNITS.TB === 0) return 'TB'
  if (bytes >= CREDIT_UNITS.GB && bytes % CREDIT_UNITS.GB === 0) return 'GB'
  return 'MB'
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
