import { FREE_STORAGE_LIMIT, StorageStatus, StorageStatusReason } from '@shared/constants'
import type { Storage } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Database,
  Ellipsis,
  HardDrive,
  Loader2,
  MapPin,
  Plus,
  Power,
  Search,
  Settings2,
  TestTube2,
  Trash2,
  WifiOff,
} from 'lucide-react'
import { useMemo, useState } from 'react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useEntitlement } from '@/hooks/useEntitlement'
import {
  ApiError,
  abortObjectUpload,
  createObject,
  listStorages,
  patchStorage,
  updateStorageEgressBilling,
} from '@/lib/api'
import { eplistProviderLabel, listEplistProviders } from '@/lib/eplist'
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
type StorageFilter = 'all' | 'healthy' | 'attention' | 'failed' | 'disabled'
type StorageSort = 'default' | 'usage' | 'used' | 'bucket'

const TEST_CONTENT = 'zpan storage connection test\n'
const DATA_UNITS = { MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 } as const
const DISPLAY_DATA_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

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

function formatCapacityPair(used: number, capacity: number) {
  const unitIndex = Math.min(
    DISPLAY_DATA_UNITS.length - 1,
    Math.max(0, Math.floor(Math.log(Math.max(capacity, 1)) / Math.log(1024))),
  )
  const divisor = 1024 ** unitIndex
  const usedValue = used / divisor
  const capacityValue = capacity / divisor
  const fractionDigits = unitIndex === 0 ? 0 : usedValue > 0 && usedValue < 0.1 ? 2 : 1
  const formatValue = (value: number) => value.toFixed(fractionDigits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1')

  return `${formatValue(usedValue)} / ${formatValue(capacityValue)} ${DISPLAY_DATA_UNITS[unitIndex]}`
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
  const [filter, setFilter] = useState<StorageFilter>('all')
  const [sort, setSort] = useState<StorageSort>('default')
  const [query, setQuery] = useState('')

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
  const visibleStorages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const items = storages.filter((storage) => {
      const visualStatus = storageVisualStatus(storage)
      const matchesFilter = filter === 'all' || visualStatus === filter
      const providerLabel = eplistProviderLabel(providers, storage.provider)
      const matchesQuery =
        !normalizedQuery ||
        [storage.bucket, storage.endpoint, storage.region, providerLabel].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        )
      return matchesFilter && matchesQuery
    })
    return [...items].sort((left, right) => {
      if (sort === 'usage') return storageUsage(right) - storageUsage(left)
      if (sort === 'used') return right.used - left.used
      if (sort === 'bucket') return left.bucket.localeCompare(right.bucket)
      return 0
    })
  }, [filter, providers, query, sort, storages])

  const billingMutation = useMutation({
    mutationFn: async ({ storage, form }: { storage: Storage; form: BillingForm }) => {
      await patchStorage(storage.id, { capacity: capacityPayload(form) })
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

  const enabledMutation = useMutation({
    mutationFn: ({ storage, enabled }: { storage: Storage; enabled: boolean }) => patchStorage(storage.id, { enabled }),
    onSuccess: (storage, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'storages'] })
      toast.success(
        t(variables.enabled ? 'admin.storages.enableSuccess' : 'admin.storages.disableSuccess', {
          bucket: storage.bucket,
        }),
      )
      if (variables.enabled) handleTest(storage)
    },
    onError: (error) => toast.error(readableError(error)),
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
      if (finalResult.status !== 'idle') {
        const status = finalResult.status === 'success' ? StorageStatus.HEALTHY : StorageStatus.UNHEALTHY
        const statusReason =
          finalResult.status === 'success'
            ? null
            : finalResult.status === 'cors'
              ? StorageStatusReason.CORS
              : StorageStatusReason.UNKNOWN
        try {
          await patchStorage(storage.id, { status, statusReason })
          queryClient.invalidateQueries({ queryKey: ['admin', 'storages'] })
        } catch {
          toast.error(t('admin.storages.healthSaveFailed'))
        }
      }
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
        description={t('admin.storages.placeholder')}
        action={
          <Button size="sm" onClick={handleAddNew} disabled={storagesLimitReached}>
            <Plus className="mr-2 h-4 w-4" />
            {t('admin.storages.add')}
          </Button>
        }
      />

      {storagesLimitReached && <UpgradeHint feature="storages_unlimited" />}

      <StorageOverview storages={storages} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-lg border bg-card p-1">
          {(['all', 'healthy', 'attention', 'failed', 'disabled'] as const).map((value) => (
            <Button
              key={value}
              variant={filter === value ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 rounded-md px-2.5 text-[11px]"
              onClick={() => setFilter(value)}
            >
              {t(`admin.storages.filter.${value}`)}
              <span className="ml-1 rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {storageFilterCount(storages, value)}
              </span>
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1 sm:w-60">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('admin.storages.searchPlaceholder')}
              className="h-8 rounded-lg bg-card pl-9 text-xs"
            />
          </div>
          <Select value={sort} onValueChange={(value) => setSort(value as StorageSort)}>
            <SelectTrigger className="h-8 w-36 rounded-lg bg-card text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['default', 'usage', 'used', 'bucket'] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`admin.storages.sort.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {visibleStorages.length > 0 ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {visibleStorages.map((storage) => (
            <StorageCard
              key={storage.id}
              storage={storage}
              providerLabel={eplistProviderLabel(providers, storage.provider)}
              testing={testTarget?.id === storage.id && testHealth.status === 'testing'}
              toggling={enabledMutation.isPending && enabledMutation.variables?.storage.id === storage.id}
              onTest={() => handleTest(storage)}
              onToggle={() => enabledMutation.mutate({ storage, enabled: !storage.enabled })}
              onEdit={() => handleEdit(storage)}
              onConfigureBilling={() => handleConfigureBilling(storage)}
              onDelete={() => setDeleteTarget({ id: storage.id, bucket: storage.bucket })}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-muted-foreground">
          <Database className="size-10" />
          <p>{storages.length === 0 ? t('admin.storages.noStorages') : t('admin.storages.noMatches')}</p>
        </div>
      )}

      <StorageFormDrawer
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        storage={editingStorage}
        onCreated={handleTest}
      />

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

function StorageOverview({ storages }: { storages: Storage[] }) {
  const { t } = useTranslation()
  const enabled = storages.filter((storage) => storage.enabled).length
  const bounded = storages.filter((storage) => storage.capacity > 0)
  const capacity = bounded.reduce((total, storage) => total + storage.capacity, 0)
  const used = storages.reduce((total, storage) => total + storage.used, 0)
  const healthy = storages.filter((storage) => storage.enabled && storage.status === StorageStatus.HEALTHY).length

  const items = [
    {
      icon: Boxes,
      iconClassName: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      label: t('admin.storages.overview.backends'),
      value: String(storages.length),
    },
    {
      icon: Database,
      iconClassName: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
      label: t('admin.storages.overview.capacity'),
      value: formatSize(capacity),
    },
    {
      icon: HardDrive,
      iconClassName: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
      label: t('admin.storages.overview.used'),
      value: formatSize(used),
      detail:
        capacity > 0 ? t('admin.storages.overview.usage', { percent: Math.round((used / capacity) * 100) }) : undefined,
    },
    {
      icon: Activity,
      iconClassName: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      label: t('admin.storages.overview.health'),
      value: `${healthy}/${enabled}`,
    },
  ]

  return (
    <section className="grid overflow-hidden rounded-xl border bg-card shadow-xs sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div
            key={item.label}
            className="flex min-h-[76px] items-center gap-2.5 border-b px-3 py-2.5 last:border-b-0 sm:border-r sm:[&:nth-child(2)]:border-r-0 xl:border-b-0 xl:[&:nth-child(2)]:border-r"
          >
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${item.iconClassName}`}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
              <div className="flex min-w-0 items-baseline gap-1.5">
                <p className="shrink-0 text-base leading-5 font-semibold tracking-tight tabular-nums">{item.value}</p>
                {item.detail && <p className="truncate text-[10px] text-muted-foreground">{item.detail}</p>}
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function storageUsage(storage: Storage) {
  if (storage.capacity <= 0) return -1
  return storage.used / storage.capacity
}

function storageVisualStatus(storage: Storage): Exclude<StorageFilter, 'all'> {
  if (!storage.enabled) return 'disabled'
  if (storage.status === StorageStatus.UNHEALTHY) return 'failed'
  if (storage.status === StorageStatus.UNKNOWN || storageUsage(storage) >= 0.9) {
    return 'attention'
  }
  return 'healthy'
}

function storageFilterCount(storages: Storage[], filter: StorageFilter) {
  if (filter === 'all') return storages.length
  return storages.filter((storage) => storageVisualStatus(storage) === filter).length
}

function StorageCard({
  storage,
  providerLabel,
  testing,
  toggling,
  onTest,
  onToggle,
  onEdit,
  onConfigureBilling,
  onDelete,
}: {
  storage: Storage
  providerLabel: string
  testing: boolean
  toggling: boolean
  onTest: () => void
  onToggle: () => void
  onEdit: () => void
  onConfigureBilling: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const usage = storageUsage(storage)
  const percent = usage < 0 ? null : Math.round(usage * 100)
  const visiblePercent = Math.min(100, Math.max(0, percent ?? 0))
  const available = storage.capacity > 0 ? Math.max(0, storage.capacity - storage.used) : null
  const visualStatus = storageVisualStatus(storage)
  const badgeStatus = testing ? 'testing' : visualStatus
  const ringClassName =
    !storage.enabled || percent === null
      ? 'text-muted-foreground'
      : percent >= 90
        ? 'text-amber-500'
        : 'text-blue-600 dark:text-blue-400'

  return (
    <article className="relative overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03),0_6px_18px_rgba(15,23,42,0.04)]">
      <header className="flex min-h-[60px] items-center gap-2.5 border-b px-3.5 py-2.5">
        <span className="flex h-8 min-w-14 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-500/10 px-2 text-blue-700 dark:text-blue-400">
          <Database className="size-4" />
          <b className="max-w-12 truncate text-[10px] tracking-wide uppercase">{storage.provider || 'S3'}</b>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold">{providerLabel || storage.provider || 'S3'}</h3>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={storage.endpoint}>
            {storage.endpoint}
          </p>
        </div>
        <StorageStatusBadge status={badgeStatus} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t('admin.storages.cardActions', { bucket: storage.bucket })}
            >
              <Ellipsis className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onToggle} disabled={toggling}>
              {toggling ? <Loader2 className="animate-spin" /> : <Power />}
              {t(storage.enabled ? 'admin.storages.disableAction' : 'admin.storages.enableAction')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onTest} disabled={!storage.enabled || testing}>
              {testing ? <Loader2 className="animate-spin" /> : <TestTube2 />}
              {t('admin.storages.testAction')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onConfigureBilling}>
              <Settings2 />
              {t('admin.storages.capacityBilling')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="grid grid-cols-1 items-center gap-4 px-4 py-3.5 sm:grid-cols-[140px_minmax(0,1fr)]">
        <StorageUsageRing
          className={ringClassName}
          percent={percent}
          visiblePercent={visiblePercent}
          used={storage.used}
          capacity={storage.capacity}
          ariaLabel={
            percent === null
              ? t('admin.storages.capacityUnbounded')
              : t('admin.storages.capacityAria', { percent, used: formatSize(storage.used) })
          }
        />

        <dl className="grid min-w-0 grid-cols-2 gap-2">
          <div className="col-span-2 flex min-h-12 min-w-0 items-center gap-2 rounded-lg bg-muted/55 px-2.5 py-2">
            <Database className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <dt className="text-[10px] text-muted-foreground">{t('admin.storages.colBucket')}</dt>
              <dd className="mt-0.5 truncate font-mono text-[11px] font-semibold" title={storage.bucket}>
                {storage.bucket}
              </dd>
            </div>
          </div>
          <div className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg bg-muted/55 px-2.5 py-2">
            <HardDrive className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <dt className="text-[10px] text-muted-foreground">{t('admin.storages.available')}</dt>
              <dd className="mt-0.5 truncate text-[11px] font-semibold">
                {available === null ? t('admin.storages.unbounded') : formatSize(available)}
              </dd>
            </div>
          </div>
          <div className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg bg-muted/55 px-2.5 py-2">
            <MapPin className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <dt className="text-[10px] text-muted-foreground">{t('admin.storages.fieldRegion')}</dt>
              <dd className="mt-0.5 truncate text-[11px] font-semibold" title={storage.region}>
                {storage.region}
              </dd>
            </div>
          </div>
        </dl>
      </div>

      <footer className="flex min-h-11 items-center justify-between border-t bg-muted/25 px-2.5 pl-3.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          {testing ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
          ) : storage.status === StorageStatus.UNHEALTHY ? (
            <WifiOff className="size-3.5 shrink-0" />
          ) : (
            <Activity className="size-3.5 shrink-0" />
          )}
          <span className="truncate">
            {storage.statusReason ? `${t(`admin.storages.statusReason.${storage.statusReason}`)} · ` : ''}
            {storage.statusCheckedAt
              ? t('admin.storages.lastChecked', { value: new Date(storage.statusCheckedAt).toLocaleString() })
              : t('admin.storages.neverChecked')}
          </span>
        </span>
        <Button variant="ghost" size="sm" className="h-8 text-xs text-primary" onClick={onEdit}>
          {t('admin.storages.manageAction')}
          <ArrowRight className="ml-1 size-3.5" />
        </Button>
      </footer>
    </article>
  )
}

function StorageUsageRing({
  className,
  percent,
  visiblePercent,
  used,
  capacity,
  ariaLabel,
}: {
  className: string
  percent: number | null
  visiblePercent: number
  used: number
  capacity: number
  ariaLabel: string
}) {
  const { t } = useTranslation()
  const radius = 53
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - visiblePercent / 100)
  const valueClassName = percent === null || Math.abs(percent) >= 1000 ? 'text-lg' : 'text-[22px]'

  return (
    <div
      data-testid="storage-usage-ring"
      className={`relative mx-auto size-[132px] shrink-0 ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      <svg className="size-full -rotate-90" viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={radius} fill="none" stroke="currentColor" strokeWidth="15" className="text-muted" />
        <circle
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="15"
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-[15px] flex flex-col items-center justify-center rounded-full bg-card text-center text-foreground">
        <strong
          className={`max-w-[96px] whitespace-nowrap leading-none font-semibold tracking-tight tabular-nums ${valueClassName}`}
        >
          {percent === null ? formatSize(used) : `${percent}%`}
        </strong>
        {percent === null ? (
          <span className="mt-1.5 whitespace-nowrap text-[9px] leading-none text-muted-foreground">
            {t('admin.storages.usedLabel')}
          </span>
        ) : (
          <span
            data-testid="storage-usage-detail"
            className="mt-1.5 max-w-[96px] whitespace-nowrap text-[9px] leading-none text-muted-foreground tabular-nums"
            title={`${formatSize(used)} / ${formatSize(capacity)}`}
          >
            {formatCapacityPair(used, capacity)}
          </span>
        )}
      </div>
    </div>
  )
}

function StorageStatusBadge({ status }: { status: Exclude<StorageFilter, 'all'> | 'testing' }) {
  const { t } = useTranslation()
  const className =
    status === 'healthy'
      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
      : status === 'failed'
        ? 'bg-destructive/10 text-destructive'
        : status === 'attention'
          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'bg-muted text-muted-foreground'

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${className}`}
    >
      {status === 'testing' ? (
        <Loader2 className="size-3 animate-spin" />
      ) : status === 'failed' ? (
        <WifiOff className="size-3" />
      ) : (
        <span className="size-1.5 rounded-full bg-current" />
      )}
      {t(`admin.storages.cardStatus.${status}`)}
    </span>
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
