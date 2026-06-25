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
import { AdminFormDrawer, AdminFormLabel } from '@/components/admin/admin-form-drawer'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { DeleteStorageDialog } from '@/components/admin/delete-storage-dialog'
import { StorageFormDrawer } from '@/components/admin/storage-form-drawer'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useEntitlement } from '@/hooks/useEntitlement'
import {
  ApiError,
  abortObjectUpload,
  createObject,
  listStorages,
  updateStorage,
  updateStorageEgressBilling,
} from '@/lib/api'
import { type EplistProvider, eplistProviderLabel, listEplistProviders } from '@/lib/eplist'
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
type StorageTestStep = 'creating' | 'uploading' | 'cleanup'
type StorageTestPosition = StorageTestStep | 'done'
type StorageTestStepState = 'done' | 'failed' | 'active' | 'pending'

const TEST_CONTENT = 'zpan storage connection test\n'
const DATA_UNITS = { MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 } as const

type DataUnit = keyof typeof DATA_UNITS
type BillingForm = {
  capacityValue: string
  capacityUnit: DataUnit
  enabled: boolean
  unitValue: string
  unit: DataUnit
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
  const [billingForm, setBillingForm] = useState<BillingForm>(emptyBillingForm())
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; bucket: string } | null>(null)
  const [testTarget, setTestTarget] = useState<Storage | null>(null)
  const [testHealth, setTestHealth] = useState<StorageHealth>({ status: 'idle' })
  const [testStep, setTestStep] = useState<StorageTestPosition>('done')
  const [testFailedStep, setTestFailedStep] = useState<StorageTestStep | null>(null)

  const storagesQuery = useQuery({
    queryKey: ['admin', 'storages'],
    queryFn: listStorages,
  })
  const providersQuery = useQuery({
    queryKey: ['eplist', 'providers'],
    queryFn: listEplistProviders,
    staleTime: 24 * 60 * 60 * 1000,
  })

  const storages = storagesQuery.data?.items ?? []
  const providers = providersQuery.data ?? []
  const storagesLimitReached = !hasFeature('storages_unlimited') && storages.length >= FREE_STORAGE_LIMIT
  const hasTrafficBilling = hasFeature('quota_store')

  const billingMutation = useMutation({
    mutationFn: async ({ storage, form }: { storage: Storage; form: BillingForm }) => {
      await updateStorage(storage.id, { capacity: capacityPayload(form) })
      if (hasTrafficBilling) {
        await updateStorageEgressBilling(storage.id, egressBillingPayload(form))
      }
    },
    onSuccess: () => {
      setBillingTarget(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'storages'] })
      toast.success(t('admin.storages.billingSaveSuccess'))
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
    setBillingForm(billingFormFromStorage(storage))
  }

  function handleFormOpenChange(open: boolean) {
    setFormOpen(open)
    if (!open) setEditingStorage(null)
  }

  async function handleTest(storage: Storage) {
    setTestTarget(storage)
    setTestHealth({ status: 'testing' })
    setTestStep('creating')
    setTestFailedStep(null)
    let draft: { id: string; upload?: { sessionId: string; urls: string[] } } | null = null
    let result: StorageHealth | null = null
    let currentStep: StorageTestStep = 'creating'
    let failedStep: StorageTestStep | null = null
    const setCurrentStep = (step: StorageTestStep) => {
      currentStep = step
      setTestStep(step)
    }

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

      setCurrentStep('uploading')
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
        failedStep = 'uploading'
        return
      }

      if (!uploadResponse.ok) {
        const body = await uploadResponse.text().catch(() => '')
        const detail = body.trim() || uploadResponse.statusText || `HTTP ${uploadResponse.status}`
        throw new Error(t('admin.storages.testUploadFailed', { detail }))
      }

      result = { status: 'success', message: t('admin.storages.testSuccess') }
    } catch (error) {
      failedStep = currentStep
      result = { status: 'error', message: readableError(error) }
    } finally {
      if (draft?.upload) {
        if (result?.status === 'success') setCurrentStep('cleanup')
        try {
          await abortObjectUpload(draft.id, draft.upload.sessionId, { strictStorageCleanup: true })
        } catch (cleanupError) {
          const cleanupMessage = t('admin.storages.testCleanupFailed', { detail: readableError(cleanupError) })
          if (result?.status === 'success') failedStep = 'cleanup'
          result =
            result?.status === 'success'
              ? { status: 'error', message: cleanupMessage }
              : result
                ? { ...result, message: `${result.message} ${cleanupMessage}` }
                : { status: 'error', message: cleanupMessage }
        }
      }
      const finalResult = result ?? { status: 'idle' as const }
      setTestFailedStep(
        finalResult.status === 'success' || finalResult.status === 'idle' ? null : (failedStep ?? currentStep),
      )
      setTestStep(finalResult.status === 'success' ? 'done' : (failedStep ?? currentStep))
      setTestHealth(result ?? { status: 'idle' })
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
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colBucket')}</th>
              <th className="hidden px-4 py-3 text-left font-medium md:table-cell">
                {t('admin.storages.colProvider')}
              </th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colAccessKey')}</th>
              <th className="hidden max-w-48 px-4 py-3 text-left font-medium lg:table-cell">
                {t('admin.storages.colEndpoint')}
              </th>
              <th className="hidden px-4 py-3 text-left font-medium lg:table-cell">
                {t('admin.storages.colEgressBilling')}
              </th>
              <th className="px-4 py-3 text-left font-medium">{t('admin.storages.colStatus')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('admin.storages.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {storages.map((storage) => (
              <StorageTableRow
                key={storage.id}
                storage={storage}
                providers={providers}
                hasTrafficBilling={hasTrafficBilling}
                testing={testTarget?.id === storage.id && testHealth.status === 'testing'}
                onTest={() => handleTest(storage)}
                onEdit={() => handleEdit(storage)}
                onConfigureBilling={() => handleConfigureBilling(storage)}
                onDelete={() => setDeleteTarget({ id: storage.id, bucket: storage.bucket })}
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

      <StorageTestDialog
        storage={testTarget}
        health={testHealth}
        step={testStep}
        failedStep={testFailedStep}
        open={testTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTestTarget(null)
        }}
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
  providers,
  hasTrafficBilling,
  testing,
  onTest,
  onEdit,
  onConfigureBilling,
  onDelete,
}: {
  storage: Storage
  providers: EplistProvider[]
  hasTrafficBilling: boolean
  testing: boolean
  onTest: () => void
  onEdit: () => void
  onConfigureBilling: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  const isActive = storage.status === StorageStatus.ACTIVE
  const provider = storage.provider?.trim() ?? ''

  const statusBadge = isActive ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground'

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 font-medium">{storage.bucket}</td>
      <td className="hidden max-w-44 truncate px-4 py-3 text-muted-foreground md:table-cell" title={provider}>
        {provider ? eplistProviderLabel(providers, provider) : ''}
      </td>
      <td className="max-w-44 truncate px-4 py-3 font-mono text-muted-foreground text-xs" title={storage.accessKey}>
        {storage.accessKey}
      </td>
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
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onTest}
            title={t('admin.storages.testAction')}
            disabled={testing}
          >
            {testing ? <Loader2 className="animate-spin" /> : <TestTube2 />}
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

function StorageTestDialog({
  storage,
  health,
  step,
  failedStep,
  open,
  onOpenChange,
}: {
  storage: Storage | null
  health: StorageHealth
  step: StorageTestPosition
  failedStep: StorageTestStep | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const steps: Array<{ key: StorageTestStep; label: string }> = [
    { key: 'creating', label: t('admin.storages.testStepCreate') },
    { key: 'uploading', label: t('admin.storages.testStepUpload') },
    { key: 'cleanup', label: t('admin.storages.testStepCleanup') },
  ]
  const activeIndex = step === 'done' ? steps.length : steps.findIndex((item) => item.key === step)
  const failedIndex = failedStep ? steps.findIndex((item) => item.key === failedStep) : -1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('admin.storages.testDialogTitle')}</DialogTitle>
          <DialogDescription>{storage?.bucket ?? ''}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <StorageTestResult health={health} />

          <div className="overflow-hidden rounded-md border">
            {steps.map((item, index) => {
              const state = getStorageTestStepState({
                index,
                activeIndex,
                failedIndex,
                health,
              })
              return (
                <div
                  key={item.key}
                  data-testid={`storage-test-step-${item.key}`}
                  data-state={state}
                  className={`flex items-center justify-between gap-3 border-b px-3 py-2.5 text-sm last:border-b-0 ${storageTestStepClassName(
                    state,
                  )}`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <StorageTestStepIcon state={state} />
                    <span className="truncate">{item.label}</span>
                  </div>
                  <span className="shrink-0 text-xs">{storageTestStepStatusLabel(t, state)}</span>
                </div>
              )
            })}
          </div>

          {health.status === 'cors' && (
            <details className="rounded-md border bg-muted/20 p-3">
              <summary className="cursor-pointer text-sm font-medium">{t('admin.storages.testCorsConfig')}</summary>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('admin.storages.testCorsCaveat')}</p>
              <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-background p-3 font-mono text-[11px] leading-4 text-muted-foreground">
                {health.corsJson}
              </pre>
            </details>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={health.status === 'testing'}
          >
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function getStorageTestStepState({
  index,
  activeIndex,
  failedIndex,
  health,
}: {
  index: number
  activeIndex: number
  failedIndex: number
  health: StorageHealth
}): StorageTestStepState {
  if (failedIndex === index && health.status !== 'testing') return 'failed'
  if (activeIndex === index && health.status === 'testing') return 'active'
  if (health.status === 'success') return 'done'
  if (failedIndex >= 0) return index < failedIndex ? 'done' : 'pending'
  if (activeIndex > index) return 'done'
  return 'pending'
}

function storageTestStepClassName(state: StorageTestStepState) {
  switch (state) {
    case 'done':
      return 'bg-green-500/5 text-foreground'
    case 'failed':
      return 'bg-destructive/5 text-destructive'
    case 'active':
      return 'bg-muted/50 text-foreground'
    case 'pending':
      return 'text-muted-foreground'
  }
}

function storageTestStepStatusLabel(t: (key: string) => string, state: StorageTestStepState) {
  switch (state) {
    case 'done':
      return t('admin.storages.testStepDone')
    case 'failed':
      return t('admin.storages.testStepFailed')
    case 'active':
      return t('admin.storages.testStepRunning')
    case 'pending':
      return t('admin.storages.testStepPending')
  }
}

function StorageTestStepIcon({ state }: { state: StorageTestStepState }) {
  if (state === 'active') return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
  if (state === 'failed') return <AlertTriangle className="size-4 shrink-0 text-destructive" />
  if (state === 'done') return <CheckCircle2 className="size-4 shrink-0 text-green-700 dark:text-green-400" />
  return <span className="size-4 shrink-0 rounded-full border" />
}

function StorageTestResult({ health }: { health: StorageHealth }) {
  const { t } = useTranslation()

  if (health.status === 'idle') return null

  if (health.status === 'testing') {
    return (
      <div
        data-testid="storage-test-result"
        className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
      >
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
        <span>{t('admin.storages.healthTesting')}</span>
      </div>
    )
  }

  if (health.status === 'success') {
    return (
      <div
        data-testid="storage-test-result"
        className="flex items-start gap-2 rounded-md border border-green-500/25 bg-green-500/5 p-3 text-sm text-green-700 dark:text-green-400"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        <span>{health.message}</span>
      </div>
    )
  }

  return (
    <div
      data-testid="storage-test-result"
      className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span className="leading-5">{health.message}</span>
    </div>
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
  form: BillingForm
  open: boolean
  pending: boolean
  hasTrafficBilling: boolean
  onFormChange: (form: BillingForm) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const validCapacity = Number(form.capacityValue) >= 0
  const validEgress = Number(form.unitValue) >= 1 && Number(form.credits) >= 1
  const canSave = validCapacity && (!hasTrafficBilling || !form.enabled || validEgress)
  const billingFieldsDisabled = !hasTrafficBilling || !form.enabled

  return (
    <AdminFormDrawer
      open={open}
      onOpenChange={onOpenChange}
      onOpenAutoFocus={(event) => event.preventDefault()}
      title={t('admin.storages.billingTitle')}
      description={t('admin.storages.billingDescription', { bucket: storage?.bucket ?? '' })}
      bodyClassName="space-y-3"
      formProps={{
        onSubmit: (event) => {
          event.preventDefault()
          if (canSave) onConfirm()
        },
      }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending || !canSave}>
            {pending ? t('common.loading') : t('common.save')}
          </Button>
        </>
      }
    >
      <section className="space-y-1.5">
        <div className="min-w-0">
          <AdminFormLabel htmlFor="storage-capacity-value" className="font-medium" required>
            {t('admin.storages.fieldCapacity')}
          </AdminFormLabel>
          <p id="storage-capacity-description" className="text-xs leading-5 text-muted-foreground">
            {t('admin.storages.capacityHint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DataAmountInput
            id="storage-capacity-value"
            describedBy="storage-capacity-description"
            min={0}
            placeholder={t('admin.storages.capacityPlaceholder')}
            value={form.capacityValue}
            unit={form.capacityUnit}
            required
            onValueChange={(capacityValue) => onFormChange({ ...form, capacityValue })}
            onUnitChange={(capacityUnit) => onFormChange({ ...form, capacityUnit })}
          />
        </div>
      </section>

      <section className="space-y-2 border-t pt-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <AdminFormLabel
              htmlFor="egressCreditBillingEnabled"
              className="font-medium"
              help={t('admin.storages.egressBillingHint')}
            >
              <span>{t('admin.storages.egressBilling')}</span>
              <ProBadge className="px-1.5 py-0 text-[10px] leading-4" />
            </AdminFormLabel>
            {!hasTrafficBilling && (
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {t('admin.storages.egressBillingBusinessOnly')}
              </p>
            )}
          </div>
          <Switch
            id="egressCreditBillingEnabled"
            className="mt-0.5"
            disabled={!hasTrafficBilling}
            checked={form.enabled}
            onCheckedChange={(enabled) => onFormChange({ ...form, enabled: hasTrafficBilling && enabled })}
          />
        </div>

        <div className="space-y-2.5">
          <div className="space-y-1">
            <AdminFormLabel htmlFor="storage-egress-credit-unit-value" required={hasTrafficBilling && form.enabled}>
              {t('admin.storages.egressBillingUnit')}
            </AdminFormLabel>
            <div className="flex items-center gap-2">
              <DataAmountInput
                id="storage-egress-credit-unit-value"
                min={1}
                placeholder={t('admin.storages.egressBillingUnitPlaceholder')}
                value={form.unitValue}
                unit={form.unit}
                disabled={billingFieldsDisabled}
                required={hasTrafficBilling && form.enabled}
                onValueChange={(unitValue) => onFormChange({ ...form, unitValue })}
                onUnitChange={(unit) => onFormChange({ ...form, unit })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <AdminFormLabel htmlFor="storage-egress-credit-per-unit" required={hasTrafficBilling && form.enabled}>
              {t('admin.storages.egressBillingCredits')}
            </AdminFormLabel>
            <Input
              id="storage-egress-credit-per-unit"
              type="number"
              min={1}
              step={1}
              value={form.credits}
              placeholder={t('admin.storages.egressBillingCreditsPlaceholder')}
              disabled={billingFieldsDisabled}
              aria-required={hasTrafficBilling && form.enabled ? true : undefined}
              onChange={(event) => onFormChange({ ...form, credits: event.target.value })}
              className="w-48"
            />
          </div>
        </div>
      </section>
    </AdminFormDrawer>
  )
}

function emptyBillingForm(): BillingForm {
  return {
    capacityValue: '0',
    capacityUnit: 'GB',
    enabled: false,
    unitValue: '100',
    unit: 'MB',
    credits: '1',
  }
}

function billingFormFromStorage(storage: Storage): BillingForm {
  const capacityUnit = storage.capacity > 0 ? bytesToUnit(storage.capacity) : 'GB'
  const unit = bytesToUnit(storage.egressCreditUnitBytes)
  return {
    capacityValue: String(storage.capacity > 0 ? storage.capacity / DATA_UNITS[capacityUnit] : 0),
    capacityUnit,
    enabled: storage.egressCreditBillingEnabled,
    unitValue: String(Math.max(1, storage.egressCreditUnitBytes / DATA_UNITS[unit])),
    unit,
    credits: String(storage.egressCreditPerUnit),
  }
}

function capacityPayload(form: BillingForm) {
  return Math.max(0, Math.floor(Number(form.capacityValue))) * DATA_UNITS[form.capacityUnit]
}

function egressBillingPayload(form: BillingForm) {
  return {
    enabled: form.enabled,
    unitBytes: Math.max(1, Math.floor(Number(form.unitValue))) * DATA_UNITS[form.unit],
    creditsPerUnit: Math.max(1, Math.floor(Number(form.credits))),
  }
}

function DataAmountInput({
  id,
  describedBy,
  value,
  unit,
  min,
  placeholder,
  disabled,
  required,
  onValueChange,
  onUnitChange,
}: {
  id: string
  describedBy?: string
  value: string
  unit: DataUnit
  min: number
  placeholder?: string
  disabled?: boolean
  required?: boolean
  onValueChange: (value: string) => void
  onUnitChange: (unit: DataUnit) => void
}) {
  return (
    <div className="flex h-9 w-48 items-center overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-disabled:pointer-events-none has-disabled:opacity-50 dark:bg-input/30">
      <Input
        id={id}
        aria-describedby={describedBy}
        type="number"
        min={min}
        step={1}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-required={required ? true : undefined}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-8 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <Select value={unit} disabled={disabled} onValueChange={(nextUnit) => onUnitChange(nextUnit as DataUnit)}>
        <SelectTrigger className="h-8 w-20 rounded-none border-0 border-l bg-transparent px-2 shadow-none focus-visible:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="MB">MB</SelectItem>
          <SelectItem value="GB">GB</SelectItem>
          <SelectItem value="TB">TB</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function bytesToUnit(bytes: number): DataUnit {
  if (bytes >= DATA_UNITS.TB && bytes % DATA_UNITS.TB === 0) return 'TB'
  if (bytes >= DATA_UNITS.GB && bytes % DATA_UNITS.GB === 0) return 'GB'
  return 'MB'
}
