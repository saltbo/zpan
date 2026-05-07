import type { GiftCardStatus } from '@shared/schemas'
import type { QuotaStorePackage, QuotaStoreSettings } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, CircleSlash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StorageOrdersTable } from '@/components/admin/storage-orders-table'
import {
  GiftCardsTab,
  PackagesTab,
  useGiftCardActions,
  usePackageEditor,
} from '@/components/admin/storage-plans-admin-actions'
import {
  type StoragePlansAdminTab,
  StoragePlansTabBar,
  StoragePlansTabState,
} from '@/components/admin/storage-plans-admin-shell'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ApiError,
  getQuotaStoreSettings,
  listAdminStoreOrders,
  listQuotaStorePackages,
  listStoreGiftCards,
} from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/storage-plans')({
  component: AdminStoragePlansPage,
})

export function AdminStoragePlansPage() {
  const state = useAdminStoragePlansState()
  const { t } = useTranslation()
  if (state.query.isLoading) return <p className="py-20 text-center text-muted-foreground">{t('common.loading')}</p>
  if (!state.data) return null
  return <AdminStoragePlansContent state={state as AdminStoragePlansReadyState} />
}

function useAdminStoragePlansState() {
  const [activeTab, setActiveTab] = useState<StoragePlansAdminTab>('packages')
  const [giftCardStatus, setGiftCardStatus] = useState<GiftCardStatus | 'all'>('all')
  const query = useQuery({ queryKey: ['admin', 'storage-plans'], queryFn: loadAdminStoragePlans })
  const packageEditor = usePackageEditor()
  const giftCardActions = useGiftCardActions()
  const giftCardsQuery = useQuery({
    queryKey: ['admin', 'storage-plans', 'gift-cards', giftCardStatus],
    queryFn: () => listStoreGiftCards(giftCardStatus === 'all' ? undefined : giftCardStatus),
    enabled: query.data?.available === true && activeTab === 'codes',
    retry: false,
  })
  const ordersQuery = useQuery({
    queryKey: ['admin', 'storage-plans', 'orders'],
    queryFn: listAdminStoreOrders,
    enabled: query.data?.available === true,
    retry: false,
  })
  const data = query.data

  return {
    activeTab,
    giftCardActions,
    giftCardsQuery,
    giftCardStatus,
    data,
    ordersQuery,
    packageEditor,
    query,
    setActiveTab,
    setGiftCardStatus,
  }
}

type AdminStoragePlansReadyState = ReturnType<typeof useAdminStoragePlansState> & {
  data: NonNullable<ReturnType<typeof useAdminStoragePlansState>['data']>
}

function AdminStoragePlansContent({ state }: { state: AdminStoragePlansReadyState }) {
  const { data } = state
  return (
    <div className="max-w-6xl space-y-5">
      <PageHeading settings={data.settings} />
      <UpgradeGate available={data.available} />
      <AdminTabs state={state} />
    </div>
  )
}

function PageHeading({ settings }: { settings: QuotaStoreSettings | null }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">{t('admin.storagePlans.title')}</h2>
          <ProBadge />
        </div>
        <p className="text-sm text-muted-foreground">{t('admin.storagePlans.subtitle')}</p>
      </div>
      <StoragePlanStatusSummary settings={settings} />
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

function StoragePlanStatusSummary({ settings }: { settings: QuotaStoreSettings | null }) {
  const { t } = useTranslation()
  const open = settings?.enabled ?? false
  const connected = settings?.status === 'ready'
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <StatusPill
        active={open}
        label={t('admin.storagePlans.storeStatus')}
        tooltip={t(`admin.storagePlans.storeTip.${open ? 'open' : 'closed'}`)}
        tone={open ? 'open' : 'closed'}
      />
      <StatusPill
        active={connected}
        label={t('admin.storagePlans.cloudConnection')}
        tooltip={t(`admin.storagePlans.cloudTip.${connected ? 'connected' : 'notConnected'}`)}
        tone={connected ? 'connected' : 'muted'}
      />
    </div>
  )
}

function StatusPill({
  active,
  label,
  tooltip,
  tone,
}: {
  active: boolean
  label: string
  tooltip: string
  tone: 'open' | 'closed' | 'connected' | 'muted'
}) {
  const classes = {
    open: {
      bg: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900',
    },
    closed: {
      bg: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900',
    },
    connected: {
      bg: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900',
    },
    muted: {
      bg: 'bg-muted/60 text-muted-foreground ring-border',
    },
  }[tone]
  const Icon = active ? CheckCircle2 : tone === 'muted' ? XCircle : CircleSlash2

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex h-8 cursor-help items-center gap-2 rounded-full px-3 text-xs font-medium ring-1 ${classes.bg}`}
        >
          <span>{label}</span>
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

function AdminTabs({ state }: { state: AdminStoragePlansReadyState }) {
  if (!state.data.available) return null
  return (
    <div className="space-y-4">
      <StoragePlansTabBar activeTab={state.activeTab} onChange={state.setActiveTab} />
      {state.activeTab === 'packages' && (
        <PackagesTab available={state.data.available} packages={state.data.packages} editor={state.packageEditor} />
      )}
      {state.activeTab === 'codes' && <GiftCardsPanel state={state} />}
      {state.activeTab === 'orders' && <OrdersPanel state={state} />}
    </div>
  )
}

function GiftCardsPanel({ state }: { state: AdminStoragePlansReadyState }) {
  return (
    <StoragePlansTabState query={state.giftCardsQuery}>
      <GiftCardsTab
        actions={state.giftCardActions}
        available={state.data.available}
        codes={state.giftCardsQuery.data?.items ?? []}
        status={state.giftCardStatus}
        onStatusChange={state.setGiftCardStatus}
      />
    </StoragePlansTabState>
  )
}

function OrdersPanel({ state }: { state: AdminStoragePlansReadyState }) {
  return (
    <StoragePlansTabState query={state.ordersQuery}>
      <StorageOrdersTable orders={state.ordersQuery.data?.items ?? []} />
    </StoragePlansTabState>
  )
}

async function loadAdminStoragePlans(): Promise<{
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
