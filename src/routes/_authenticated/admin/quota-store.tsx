import type { StorageCodeStatus } from '@shared/schemas'
import type { QuotaStorePackage, QuotaStoreSettings } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CodesTab,
  PackagesTab,
  useCodeActions,
  usePackageEditor,
  useSettingsActions,
  useSyncMutation,
} from '@/components/admin/quota-store-admin-actions'
import {
  type QuotaStoreAdminTab,
  QuotaStoreStatusHeader,
  QuotaStoreTabBar,
  QuotaStoreTabState,
} from '@/components/admin/quota-store-admin-shell'
import { QuotaStoreDeliveryRecords } from '@/components/admin/quota-store-delivery-records'
import { emptySettingsForm } from '@/components/admin/quota-store-settings-panel'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Card, CardContent } from '@/components/ui/card'
import {
  ApiError,
  getQuotaStoreSettings,
  listAdminQuotaDeliveryRecords,
  listQuotaStorePackages,
  listStorageRedemptionCodes,
} from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/quota-store')({
  component: AdminQuotaStorePage,
})

export function AdminQuotaStorePage() {
  const state = useAdminQuotaStoreState()
  const { t } = useTranslation()
  if (state.query.isLoading) return <p className="py-20 text-center text-muted-foreground">{t('common.loading')}</p>
  if (!state.data) return null
  return <AdminQuotaStoreContent state={state as AdminQuotaStoreReadyState} />
}

function useAdminQuotaStoreState() {
  const [activeTab, setActiveTab] = useState<QuotaStoreAdminTab>('packages')
  const [settingsForm, setSettingsForm] = useState(emptySettingsForm)
  const [codeStatus, setCodeStatus] = useState<StorageCodeStatus | 'all'>('active')
  const query = useQuery({ queryKey: ['admin', 'quota-store'], queryFn: loadAdminQuotaStore })
  const packageEditor = usePackageEditor()
  const codeActions = useCodeActions()
  const settingsActions = useSettingsActions()
  const syncMutation = useSyncMutation()
  const codesQuery = useQuery({
    queryKey: ['admin', 'quota-store', 'storage-codes', codeStatus],
    queryFn: () => listStorageRedemptionCodes(codeStatus === 'all' ? undefined : codeStatus),
    enabled: query.data?.available === true && activeTab === 'codes',
    retry: false,
  })
  const deliveryQuery = useQuery({
    queryKey: ['admin', 'quota-store', 'delivery-records'],
    queryFn: listAdminQuotaDeliveryRecords,
    enabled: query.data?.available === true,
    retry: false,
  })
  const data = query.data

  useEffect(() => {
    if (!data?.settings) return
    setSettingsForm({ enabled: data.settings.enabled })
  }, [data?.settings])

  return {
    activeTab,
    codeActions,
    codesQuery,
    codeStatus,
    data,
    deliveryQuery,
    packageEditor,
    query,
    setActiveTab,
    setCodeStatus,
    setSettingsForm,
    settingsActions,
    settingsForm,
    syncMutation,
  }
}

type AdminQuotaStoreReadyState = ReturnType<typeof useAdminQuotaStoreState> & {
  data: NonNullable<ReturnType<typeof useAdminQuotaStoreState>['data']>
}

function AdminQuotaStoreContent({ state }: { state: AdminQuotaStoreReadyState }) {
  const { data } = state
  return (
    <div className="max-w-6xl space-y-5">
      <PageHeading />
      <UpgradeGate available={data.available} />
      <StatusHeader state={state} />
      <AdminTabs state={state} />
    </div>
  )
}

function PageHeading() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">{t('admin.quotaStore.title')}</h2>
          <ProBadge />
        </div>
        <p className="text-sm text-muted-foreground">{t('admin.quotaStore.subtitle')}</p>
      </div>
    </div>
  )
}

function UpgradeGate({ available }: { available: boolean }) {
  if (available) return null
  return (
    <Card className="border-border/60">
      <CardContent className="pt-6">
        <UpgradeHint feature="quota_store" />
      </CardContent>
    </Card>
  )
}

function StatusHeader({ state }: { state: AdminQuotaStoreReadyState }) {
  return (
    <QuotaStoreStatusHeader
      available={state.data.available}
      settings={state.data.settings}
      packages={state.data.packages}
      grants={state.deliveryQuery.data?.items ?? []}
      form={state.settingsForm}
      settingsPending={state.settingsActions.isPending}
      syncPending={state.syncMutation.isPending}
      onFormChange={state.setSettingsForm}
      onSave={() => state.settingsActions.save(state.settingsForm)}
      onSync={() => state.syncMutation.mutate()}
    />
  )
}

function AdminTabs({ state }: { state: AdminQuotaStoreReadyState }) {
  return (
    <div className="space-y-4">
      <QuotaStoreTabBar activeTab={state.activeTab} onChange={state.setActiveTab} />
      {state.activeTab === 'packages' && (
        <PackagesTab available={state.data.available} packages={state.data.packages} editor={state.packageEditor} />
      )}
      {state.activeTab === 'codes' && <CodesPanel state={state} />}
      {state.activeTab === 'delivery' && <DeliveryPanel state={state} />}
    </div>
  )
}

function CodesPanel({ state }: { state: AdminQuotaStoreReadyState }) {
  return (
    <QuotaStoreTabState query={state.codesQuery}>
      <CodesTab
        actions={state.codeActions}
        available={state.data.available}
        codes={state.codesQuery.data?.items ?? []}
        status={state.codeStatus}
        onStatusChange={state.setCodeStatus}
      />
    </QuotaStoreTabState>
  )
}

function DeliveryPanel({ state }: { state: AdminQuotaStoreReadyState }) {
  return (
    <QuotaStoreTabState query={state.deliveryQuery}>
      <QuotaStoreDeliveryRecords grants={state.deliveryQuery.data?.items ?? []} />
    </QuotaStoreTabState>
  )
}

async function loadAdminQuotaStore(): Promise<{
  available: boolean
  enabled: boolean
  settings: QuotaStoreSettings | null
  packages: QuotaStorePackage[]
}> {
  try {
    const [settings, packages] = await Promise.all([getQuotaStoreSettings(), listQuotaStorePackages()])
    return { available: true, enabled: settings?.enabled ?? false, settings, packages: packages.items }
  } catch (err) {
    if (err instanceof ApiError && err.status === 402) {
      return { available: false, enabled: false, settings: null, packages: [] }
    }
    throw err
  }
}
