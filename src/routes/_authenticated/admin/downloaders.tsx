import type { Downloader } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Activity, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField, AdminFormLabel } from '@/components/admin/admin-form-drawer'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { ProBadge } from '@/components/ProBadge'
import { Badge } from '@/components/ui/badge'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useEntitlement } from '@/hooks/useEntitlement'
import { deleteDownloader, listDownloaders, updateDownloader, updateDownloaderCreditBilling } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/downloaders')({
  component: AdminDownloadersPage,
})

const QUERY_KEY = ['admin', 'downloaders']
const CREDIT_UNITS = { MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 } as const

type CreditUnit = keyof typeof CREDIT_UNITS
type CreditBillingForm = {
  enabled: boolean
  unitValue: string
  unit: CreditUnit
  credits: string
}
type DownloaderSettingsForm = CreditBillingForm & {
  name: string
  downloaderEnabled: boolean
}

export function AdminDownloadersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { hasFeature } = useEntitlement()
  const hasTrafficBilling = hasFeature('quota_store')
  const [deleteTarget, setDeleteTarget] = useState<Downloader | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<Downloader | null>(null)
  const [settingsForm, setSettingsForm] = useState<DownloaderSettingsForm>(emptySettingsForm())

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: listDownloaders,
    refetchInterval: 5000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDownloader(id),
    onSuccess: () => {
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(t('admin.downloaders.deleteSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const settingsMutation = useMutation({
    mutationFn: async ({ downloader, form }: { downloader: Downloader; form: DownloaderSettingsForm }) => {
      await updateDownloader(downloader.id, { name: form.name.trim(), enabled: form.downloaderEnabled })
      if (hasTrafficBilling) {
        await updateDownloaderCreditBilling(downloader.id, billingPayload(form))
      }
    },
    onSuccess: () => {
      setSettingsTarget(null)
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(t('admin.downloaders.settingsSaveSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const downloaders = query.data?.items ?? []
  const openSettings = (downloader: Downloader) => {
    setSettingsTarget(downloader)
    setSettingsForm(settingsFormFromDownloader(downloader))
  }

  return (
    <div className="max-w-6xl space-y-4">
      <AdminPageHeader title={t('admin.downloaders.title')} description={t('admin.downloaders.subtitle')} />

      <section className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.downloaders.table.name')}</TableHead>
              <TableHead>{t('admin.downloaders.table.status')}</TableHead>
              <TableHead>{t('admin.downloaders.table.engine')}</TableHead>
              <TableHead>{t('admin.downloaders.table.tasks')}</TableHead>
              <TableHead>{t('admin.downloaders.table.speed')}</TableHead>
              <TableHead>{t('admin.downloaders.table.billing')}</TableHead>
              <TableHead className="text-right">{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {downloaders.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                  {query.isLoading ? t('common.loading') : t('admin.downloaders.empty')}
                </TableCell>
              </TableRow>
            )}
            {downloaders.map((downloader) => (
              <DownloaderRow
                key={downloader.id}
                downloader={downloader}
                hasTrafficBilling={hasTrafficBilling}
                onSettings={() => openSettings(downloader)}
                onDelete={() => setDeleteTarget(downloader)}
              />
            ))}
          </TableBody>
        </Table>
      </section>
      <DeleteDownloaderDialog
        downloader={deleteTarget}
        open={deleteTarget !== null}
        pending={deleteMutation.isPending}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
      <DownloaderSettingsDrawer
        downloader={settingsTarget}
        form={settingsForm}
        open={settingsTarget !== null}
        pending={settingsMutation.isPending}
        hasTrafficBilling={hasTrafficBilling}
        onFormChange={setSettingsForm}
        onOpenChange={(open) => !open && setSettingsTarget(null)}
        onConfirm={() => settingsTarget && settingsMutation.mutate({ downloader: settingsTarget, form: settingsForm })}
      />
    </div>
  )
}

function DownloaderRow({
  downloader,
  hasTrafficBilling,
  onSettings,
  onDelete,
}: {
  downloader: Downloader
  hasTrafficBilling: boolean
  onSettings: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{downloader.name}</div>
        <div className="text-xs text-muted-foreground">
          {downloader.hostname} · {downloader.platform}/{downloader.arch}
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant={
            downloader.status === 'online' ? 'default' : downloader.status === 'disabled' ? 'outline' : 'secondary'
          }
        >
          {t(`admin.downloaders.status.${downloader.status}`)}
        </Badge>
        {downloader.lastHeartbeatAt && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Activity className="size-3" />
            {new Date(downloader.lastHeartbeatAt).toLocaleString()}
          </div>
        )}
      </TableCell>
      <TableCell>{downloader.engine}</TableCell>
      <TableCell>
        {downloader.currentTasks} / {downloader.maxConcurrentTasks}
      </TableCell>
      <TableCell>
        {formatBytes(downloader.downloadBps)}/s · {formatBytes(downloader.uploadBps)}/s
      </TableCell>
      <TableCell>
        {hasTrafficBilling && downloader.remoteDownloadCreditBillingEnabled
          ? `${downloader.remoteDownloadCreditPerUnit} / ${formatBytes(downloader.remoteDownloadCreditUnitBytes)}`
          : t('common.disabled')}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onSettings}
            aria-label={t('admin.downloaders.settingsAction')}
          >
            <Settings2 className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label={t('admin.downloaders.delete')}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function DownloaderSettingsDrawer({
  downloader,
  form,
  open,
  pending,
  hasTrafficBilling,
  onFormChange,
  onOpenChange,
  onConfirm,
}: {
  downloader: Downloader | null
  form: DownloaderSettingsForm
  open: boolean
  pending: boolean
  hasTrafficBilling: boolean
  onFormChange: (form: DownloaderSettingsForm) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const validName = form.name.trim().length >= 1 && form.name.trim().length <= 120
  const validBilling = Number(form.unitValue) >= 1 && Number(form.credits) >= 1
  const canSave = validName && (!hasTrafficBilling || !form.enabled || validBilling)
  const billingFieldsDisabled = !hasTrafficBilling || !form.enabled

  return (
    <AdminFormDrawer
      open={open}
      onOpenChange={onOpenChange}
      onOpenAutoFocus={(event) => event.preventDefault()}
      title={t('admin.downloaders.settingsTitle')}
      description={t('admin.downloaders.settingsDescription', { hostname: downloader?.hostname ?? '' })}
      bodyClassName="space-y-4"
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
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4 rounded-md border bg-background p-3">
          <div className="min-w-0">
            <AdminFormLabel htmlFor="downloaderEnabled" help={t('admin.downloaders.enabledHint')}>
              {t('admin.downloaders.enabled')}
            </AdminFormLabel>
          </div>
          <Switch
            id="downloaderEnabled"
            className="mt-0.5"
            checked={form.downloaderEnabled}
            onCheckedChange={(downloaderEnabled) => onFormChange({ ...form, downloaderEnabled })}
          />
        </div>

        <AdminFormField
          id="downloaderDisplayName"
          label={t('admin.downloaders.displayName')}
          required
          help={t('admin.downloaders.displayNameHint')}
        >
          <Input
            maxLength={120}
            value={form.name}
            placeholder={t('admin.downloaders.displayNamePlaceholder')}
            onChange={(event) => onFormChange({ ...form, name: event.target.value })}
          />
        </AdminFormField>
      </section>

      <section className="space-y-3 border-t pt-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <AdminFormLabel
              htmlFor="remoteDownloadCreditBillingEnabled"
              help={t('admin.downloaders.billingEnabledHint')}
            >
              <span>{t('admin.downloaders.billingEnabled')}</span>
              <ProBadge className="px-1.5 py-0 text-[10px] leading-4" />
            </AdminFormLabel>
            {!hasTrafficBilling && (
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {t('admin.downloaders.billingBusinessOnly')}
              </p>
            )}
          </div>
          <Switch
            id="remoteDownloadCreditBillingEnabled"
            className="mt-0.5"
            disabled={!hasTrafficBilling}
            checked={form.enabled}
            onCheckedChange={(enabled) => onFormChange({ ...form, enabled: hasTrafficBilling && enabled })}
          />
        </div>

        <div className="space-y-2.5">
          <div className="space-y-1">
            <AdminFormLabel htmlFor="remoteDownloadCreditUnitValue" required={hasTrafficBilling && form.enabled}>
              {t('admin.downloaders.billingUnit')}
            </AdminFormLabel>
            <div className="flex items-center gap-2">
              <DataAmountInput
                id="remoteDownloadCreditUnitValue"
                min={1}
                placeholder={t('admin.downloaders.billingUnitPlaceholder')}
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
            <AdminFormLabel htmlFor="remoteDownloadCreditPerUnit" required={hasTrafficBilling && form.enabled}>
              {t('admin.downloaders.billingCredits')}
            </AdminFormLabel>
            <Input
              id="remoteDownloadCreditPerUnit"
              type="number"
              min={1}
              step={1}
              value={form.credits}
              placeholder={t('admin.downloaders.billingCreditsPlaceholder')}
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

function DeleteDownloaderDialog({
  downloader,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  downloader: Downloader | null
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.downloaders.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('admin.downloaders.deleteConfirm', { name: downloader?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
            {t('admin.downloaders.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

function emptySettingsForm(): DownloaderSettingsForm {
  return { name: '', downloaderEnabled: true, enabled: false, unitValue: '100', unit: 'MB', credits: '1' }
}

function settingsFormFromDownloader(downloader: Downloader): DownloaderSettingsForm {
  const unit = bytesToCreditUnit(downloader.remoteDownloadCreditUnitBytes)
  return {
    name: downloader.name,
    downloaderEnabled: downloader.enabled,
    enabled: downloader.remoteDownloadCreditBillingEnabled,
    unitValue: String(Math.max(1, downloader.remoteDownloadCreditUnitBytes / CREDIT_UNITS[unit])),
    unit,
    credits: String(downloader.remoteDownloadCreditPerUnit),
  }
}

function billingPayload(form: CreditBillingForm) {
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

function DataAmountInput({
  id,
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
  value: string
  unit: CreditUnit
  min: number
  placeholder?: string
  disabled?: boolean
  required?: boolean
  onValueChange: (value: string) => void
  onUnitChange: (unit: CreditUnit) => void
}) {
  return (
    <div className="flex h-9 w-48 items-center overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-disabled:pointer-events-none has-disabled:opacity-50 dark:bg-input/30">
      <Input
        id={id}
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
      <Select value={unit} disabled={disabled} onValueChange={(nextUnit) => onUnitChange(nextUnit as CreditUnit)}>
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
