import type { GiftCardStatus } from '@shared/schemas'
import type { CloudProduct, CloudStoreSettings } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, CircleSlash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { StorageOrdersTable } from '@/components/admin/cloud-orders-table'
import {
  GiftCardsTab,
  PackagesTab,
  useGiftCardActions,
  usePackageEditor,
} from '@/components/admin/cloud-store-admin-actions'
import {
  type CloudStoreAdminTab,
  CloudStoreTabBar,
  CloudStoreTabState,
} from '@/components/admin/cloud-store-admin-shell'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ApiError,
  getCloudStoreSettings,
  listAdminCloudOrders,
  listAdminCloudProducts,
  listCloudGiftCards,
} from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/cloud-store')({
  component: AdminCloudStorePage,
})

export function AdminCloudStorePage() {
  const state = useAdminCloudStoreState()
  const { t } = useTranslation()
  if (state.query.isLoading) return <p className="py-20 text-center text-muted-foreground">{t('common.loading')}</p>
  if (state.query.isError) {
    return <p className="py-20 text-center text-destructive">{t('admin.cloudStore.tabError')}</p>
  }
  if (!state.data) return null
  return <AdminCloudStoreContent state={state as AdminCloudStoreReadyState} />
}

function useAdminCloudStoreState() {
  const [activeTab, setActiveTab] = useState<CloudStoreAdminTab>('packages')
  const [giftCardStatus, setGiftCardStatus] = useState<GiftCardStatus | 'all'>('all')
  const query = useQuery({ queryKey: ['admin', 'cloud-store'], queryFn: loadAdminCloudStore })
  const packageEditor = usePackageEditor()
  const giftCardActions = useGiftCardActions()
  const giftCardsQuery = useQuery({
    queryKey: ['admin', 'cloud-store', 'gift-cards', giftCardStatus],
    queryFn: () => listCloudGiftCards(giftCardStatus === 'all' ? undefined : giftCardStatus),
    enabled: query.data?.available === true && activeTab === 'codes',
    retry: false,
  })
  const ordersQuery = useQuery({
    queryKey: ['admin', 'cloud-store', 'orders'],
    queryFn: () => listAdminCloudOrders(),
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

type AdminCloudStoreReadyState = ReturnType<typeof useAdminCloudStoreState> & {
  data: NonNullable<ReturnType<typeof useAdminCloudStoreState>['data']>
}

function AdminCloudStoreContent({ state }: { state: AdminCloudStoreReadyState }) {
  const { data } = state
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeading settings={data.settings} />
      <UpgradeGate available={data.available} />
      <AdminTabs state={state} />
    </div>
  )
}

function PageHeading({ settings }: { settings: CloudStoreSettings | null }) {
  const { t } = useTranslation()
  return (
    <AdminPageHeader
      title={t('admin.cloudStore.title')}
      description={t('admin.cloudStore.subtitle')}
      badge={<ProBadge />}
      action={<CloudStoreStatusSummary settings={settings} />}
    />
  )
}

function UpgradeGate({ available }: { available: boolean }) {
  if (available) return null
  return <UpgradeHint feature="quota_store" />
}

function CloudStoreStatusSummary({ settings }: { settings: CloudStoreSettings | null }) {
  const { t } = useTranslation()
  const open = settings?.enabled ?? false
  const connected = settings?.status === 'ready'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill
        active={open}
        label={t('admin.cloudStore.storeStatus')}
        tooltip={t(`admin.cloudStore.storeTip.${open ? 'open' : 'closed'}`)}
        tone={open ? 'open' : 'closed'}
      />
      <StatusPill
        active={connected}
        label={t('admin.cloudStore.cloudConnection')}
        tooltip={t(`admin.cloudStore.cloudTip.${connected ? 'connected' : 'notConnected'}`)}
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

function AdminTabs({ state }: { state: AdminCloudStoreReadyState }) {
  if (!state.data.available) return null
  return (
    <div className="space-y-4">
      <CloudStoreTabBar activeTab={state.activeTab} onChange={state.setActiveTab} />
      {state.activeTab === 'packages' && (
        <PackagesTab available={state.data.available} packages={state.data.packages} editor={state.packageEditor} />
      )}
      {state.activeTab === 'codes' && <GiftCardsPanel state={state} />}
      {state.activeTab === 'orders' && <OrdersPanel state={state} />}
    </div>
  )
}

function GiftCardsPanel({ state }: { state: AdminCloudStoreReadyState }) {
  return (
    <CloudStoreTabState query={state.giftCardsQuery}>
      <GiftCardsTab
        actions={state.giftCardActions}
        available={state.data.available}
        codes={state.giftCardsQuery.data?.items ?? []}
        status={state.giftCardStatus}
        onStatusChange={state.setGiftCardStatus}
      />
    </CloudStoreTabState>
  )
}

function OrdersPanel({ state }: { state: AdminCloudStoreReadyState }) {
  return (
    <CloudStoreTabState query={state.ordersQuery}>
      <StorageOrdersTable orders={state.ordersQuery.data?.items ?? []} />
    </CloudStoreTabState>
  )
}

async function loadAdminCloudStore(): Promise<{
  available: boolean
  enabled: boolean
  settings: CloudStoreSettings | null
  packages: CloudProduct[]
}> {
  try {
    const [settings, packages] = await Promise.all([getCloudStoreSettings(), listAdminCloudProducts()])
    return { available: true, enabled: settings?.enabled ?? false, settings, packages: packages.items }
  } catch (err) {
    if (err instanceof ApiError && err.status === 402) {
      return { available: false, enabled: false, settings: null, packages: [] }
    }
    throw err
  }
}
