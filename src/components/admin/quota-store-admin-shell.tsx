import type { QuotaGrant, QuotaStorePackage, QuotaStoreSettings } from '@shared/types'
import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export type QuotaStoreAdminTab = 'packages' | 'codes' | 'delivery'

export function QuotaStoreStatusHeader({
  available,
  settings,
  packages,
  grants,
  form,
  settingsPending,
  syncPending,
  onFormChange,
  onSave,
  onSync,
}: {
  available: boolean
  settings: QuotaStoreSettings | null
  packages: QuotaStorePackage[]
  grants: QuotaGrant[]
  form: { enabled: boolean }
  settingsPending: boolean
  syncPending: boolean
  onFormChange: (form: { enabled: boolean }) => void
  onSave: () => void
  onSync: () => void
}) {
  const status = settings?.status ?? 'store_disabled'

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <StatusMetrics enabled={form.enabled} status={status} packages={packages} grants={grants} />
        <StatusControls
          available={available}
          enabled={form.enabled}
          settingsPending={settingsPending}
          syncPending={syncPending}
          onEnabledChange={(enabled) => onFormChange({ ...form, enabled })}
          onSave={onSave}
          onSync={onSync}
        />
      </div>
    </div>
  )
}

export function QuotaStoreTabBar({
  activeTab,
  onChange,
}: {
  activeTab: QuotaStoreAdminTab
  onChange: (tab: QuotaStoreAdminTab) => void
}) {
  const { t } = useTranslation()
  const tabs: Array<{ id: QuotaStoreAdminTab; label: string }> = [
    { id: 'packages', label: t('admin.quotaStore.tabs.packages') },
    { id: 'codes', label: t('admin.quotaStore.tabs.codes') },
    { id: 'delivery', label: t('admin.quotaStore.tabs.delivery') },
  ]
  return (
    <div className="flex w-full gap-1 overflow-x-auto rounded-md border bg-muted/30 p-1">
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          type="button"
          variant={activeTab === tab.id ? 'default' : 'ghost'}
          className="h-9 shrink-0"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  )
}

export function QuotaStoreTabState({
  query,
  children,
}: {
  query: { isLoading: boolean; isError: boolean }
  children: ReactNode
}) {
  const { t } = useTranslation()
  if (query.isLoading) {
    return <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
  }
  if (query.isError) {
    return (
      <div className="rounded-md border border-destructive/40 p-8 text-center text-sm text-destructive">
        {t('admin.quotaStore.tabError')}
      </div>
    )
  }
  return <>{children}</>
}

function StatusItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-32 space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}

function StatusMetrics({
  enabled,
  status,
  packages,
  grants,
}: {
  enabled: boolean
  status: NonNullable<QuotaStoreSettings['status']>
  packages: QuotaStorePackage[]
  grants: QuotaGrant[]
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-3">
      <StatusItem label={t('admin.quotaStore.enabled')} value={enabled ? t('common.active') : t('common.disabled')} />
      <StatusItem label={t('admin.quotaStore.storeStatus')} value={<StoreStatusBadge status={status} />} />
      <StatusItem label={t('admin.quotaStore.lastSync')} value={formatDate(lastPackageSync(packages))} />
      <StatusItem label={t('admin.quotaStore.lastDelivery')} value={formatDate(grants[0]?.createdAt)} />
    </div>
  )
}

function StoreStatusBadge({ status }: { status: NonNullable<QuotaStoreSettings['status']> }) {
  const { t } = useTranslation()
  return <Badge variant={status === 'ready' ? 'default' : 'secondary'}>{t(`admin.quotaStore.status.${status}`)}</Badge>
}

function StatusControls({
  available,
  enabled,
  settingsPending,
  syncPending,
  onEnabledChange,
  onSave,
  onSync,
}: {
  available: boolean
  enabled: boolean
  settingsPending: boolean
  syncPending: boolean
  onEnabledChange: (enabled: boolean) => void
  onSave: () => void
  onSync: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-10 items-center gap-3 rounded-md border px-3">
        <Label htmlFor="quotaStoreEnabled" className="text-sm">
          {t('admin.quotaStore.enabled')}
        </Label>
        <Switch
          id="quotaStoreEnabled"
          checked={enabled}
          disabled={!available || settingsPending}
          onCheckedChange={onEnabledChange}
        />
      </div>
      <Button disabled={!available || settingsPending} onClick={onSave}>
        {t('common.save')}
      </Button>
      <Button variant="outline" disabled={!available || syncPending} onClick={onSync}>
        <RefreshCw className="mr-2 h-4 w-4" />
        {t('admin.quotaStore.sync')}
      </Button>
    </div>
  )
}

function lastPackageSync(packages: QuotaStorePackage[]) {
  return packages
    .map((pkg) => pkg.updatedAt)
    .sort()
    .at(-1)
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '-'
}
