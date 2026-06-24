import type { Downloader } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Activity, Pencil, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField } from '@/components/admin/admin-form-drawer'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
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
import { Label } from '@/components/ui/label'
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

export function AdminDownloadersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { hasFeature } = useEntitlement()
  const hasTrafficBilling = hasFeature('quota_store')
  const [deleteTarget, setDeleteTarget] = useState<Downloader | null>(null)
  const [renameTarget, setRenameTarget] = useState<Downloader | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [billingTarget, setBillingTarget] = useState<Downloader | null>(null)
  const [billingForm, setBillingForm] = useState<CreditBillingForm>(emptyBillingForm())

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: listDownloaders,
    refetchInterval: 5000,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateDownloader(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err) => toast.error(err.message),
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

  const renameMutation = useMutation({
    mutationFn: ({ downloader, name }: { downloader: Downloader; name: string }) =>
      updateDownloader(downloader.id, { name: name.trim() }),
    onSuccess: () => {
      setRenameTarget(null)
      setRenameValue('')
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(t('admin.downloaders.renameSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const billingMutation = useMutation({
    mutationFn: ({ downloader, form }: { downloader: Downloader; form: CreditBillingForm }) =>
      updateDownloaderCreditBilling(
        downloader.id,
        billingPayload(hasTrafficBilling ? form : { ...form, enabled: false }),
      ),
    onSuccess: () => {
      setBillingTarget(null)
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(t('admin.downloaders.billingSaveSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const downloaders = query.data?.items ?? []
  const openRenameDialog = (downloader: Downloader) => {
    setRenameTarget(downloader)
    setRenameValue(downloader.name)
  }
  const openBillingSettings = (downloader: Downloader) => {
    setBillingTarget(downloader)
    setBillingForm(billingFormFromDownloader(downloader))
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
                onToggle={(enabled) => toggleMutation.mutate({ id: downloader.id, enabled })}
                onRename={() => openRenameDialog(downloader)}
                onConfigureBilling={() => openBillingSettings(downloader)}
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
      <RenameDownloaderDialog
        downloader={renameTarget}
        value={renameValue}
        open={renameTarget !== null}
        pending={renameMutation.isPending}
        onValueChange={setRenameValue}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null)
            setRenameValue('')
          }
        }}
        onConfirm={() => renameTarget && renameMutation.mutate({ downloader: renameTarget, name: renameValue })}
      />
      <CreditBillingDrawer
        downloader={billingTarget}
        form={billingForm}
        open={billingTarget !== null}
        pending={billingMutation.isPending}
        hasTrafficBilling={hasTrafficBilling}
        onFormChange={setBillingForm}
        onOpenChange={(open) => !open && setBillingTarget(null)}
        onConfirm={() => billingTarget && billingMutation.mutate({ downloader: billingTarget, form: billingForm })}
      />
    </div>
  )
}

function DownloaderRow({
  downloader,
  hasTrafficBilling,
  onToggle,
  onRename,
  onConfigureBilling,
  onDelete,
}: {
  downloader: Downloader
  hasTrafficBilling: boolean
  onToggle: (enabled: boolean) => void
  onRename: () => void
  onConfigureBilling: () => void
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
          <Switch size="sm" checked={downloader.enabled} onCheckedChange={onToggle} />
          <Button type="button" variant="ghost" size="icon" onClick={onRename} aria-label={t('common.edit')}>
            <Pencil className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onConfigureBilling}
            aria-label={t('admin.downloaders.configureBilling')}
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

function RenameDownloaderDialog({
  downloader,
  value,
  open,
  pending,
  onValueChange,
  onOpenChange,
  onConfirm,
}: {
  downloader: Downloader | null
  value: string
  open: boolean
  pending: boolean
  onValueChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const valid = value.trim().length >= 1 && value.trim().length <= 120
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.downloaders.renameTitle')}</DialogTitle>
          <DialogDescription>
            {t('admin.downloaders.renameDescription', { hostname: downloader?.hostname ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) onConfirm()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="downloaderDisplayName">{t('admin.downloaders.displayName')}</Label>
            <Input
              id="downloaderDisplayName"
              maxLength={120}
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CreditBillingDrawer({
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
  form: CreditBillingForm
  open: boolean
  pending: boolean
  hasTrafficBilling: boolean
  onFormChange: (form: CreditBillingForm) => void
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
      title={t('admin.downloaders.billingTitle')}
      description={t('admin.downloaders.billingDescription', { name: downloader?.name ?? '' })}
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
              {t('common.save')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        )
      }
    >
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div>
          <Label htmlFor="remoteDownloadCreditBillingEnabled">{t('admin.downloaders.billingEnabled')}</Label>
          <p className="text-xs text-muted-foreground">{t('admin.downloaders.billingEnabledHint')}</p>
        </div>
        <Switch
          id="remoteDownloadCreditBillingEnabled"
          disabled={!hasTrafficBilling}
          checked={form.enabled}
          onCheckedChange={(enabled) => onFormChange({ ...form, enabled: hasTrafficBilling && enabled })}
        />
      </div>
      {!hasTrafficBilling && (
        <p className="text-xs text-muted-foreground">{t('admin.downloaders.billingBusinessOnly')}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminFormField id="remoteDownloadCreditUnitValue" label={t('admin.downloaders.billingUnit')}>
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
        <AdminFormField id="remoteDownloadCreditPerUnit" label={t('admin.downloaders.billingCredits')}>
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

function emptyBillingForm(): CreditBillingForm {
  return { enabled: false, unitValue: '100', unit: 'MB', credits: '1' }
}

function billingFormFromDownloader(downloader: Downloader): CreditBillingForm {
  const unit = bytesToCreditUnit(downloader.remoteDownloadCreditUnitBytes)
  return {
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
