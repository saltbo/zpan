import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity, HardDrive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUserQuota, listCloudOrders, listCloudProducts } from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'
import { formatSize } from '@/lib/format'

export function QuotaPanel({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation()
  const { data: activeOrg } = useActiveOrganization()
  const workspaceId = activeOrg?.id ?? 'personal'
  const { data: quota } = useQuery({
    queryKey: ['user', 'quota', workspaceId],
    queryFn: getUserQuota,
    enabled,
  })
  const packagesQuery = useQuery({
    queryKey: ['cloud-store', 'packages'],
    queryFn: listCloudProducts,
    enabled,
    retry: false,
  })
  const { data: orders } = useQuery({
    queryKey: ['cloud-store', 'orders', workspaceId],
    queryFn: () => listCloudOrders(),
    enabled: enabled && packagesQuery.isSuccess,
  })

  if (!quota) return null

  const purchasedBytes = (orders?.items ?? [])
    .filter((order) => order.paymentStatus === 'paid')
    .reduce((sum, order) => sum + (order.items[0]?.fulfillmentPayload.storageBytes ?? 0), 0)
  const purchasedTrafficBytes = (orders?.items ?? [])
    .filter((order) => order.paymentStatus === 'paid')
    .reduce((sum, order) => sum + (order.items[0]?.fulfillmentPayload.trafficBytes ?? 0), 0)
  const storagePercent = quota.quota > 0 ? Math.round((quota.used / quota.quota) * 100) : null
  const trafficPercent = quota.trafficQuota > 0 ? Math.round((quota.trafficUsed / quota.trafficQuota) * 100) : null
  const trafficBlocked = quota.trafficQuota > 0 && quota.trafficUsed >= quota.trafficQuota

  return (
    <Link
      to="/storage"
      className="block border-t px-5 py-3 text-sidebar-foreground transition-colors hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring active:bg-sidebar-hover"
      aria-label={t('quota.storage')}
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-sidebar-foreground">
        <HardDrive className="h-3.5 w-3.5" />
        <span>{t('quota.storage')}</span>
        {storagePercent !== null && (
          <span className="ml-auto tabular-nums text-muted-foreground">{storagePercent}%</span>
        )}
      </div>
      {quota.quota > 0 && (
        <div className="mb-1.5 h-2 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(100, (quota.used / quota.quota) * 100)}%` }}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground tabular-nums">
        {quota.quota > 0
          ? t('quota.usage', { used: formatSize(quota.used), total: formatSize(quota.quota) })
          : t('quota.usageNoLimit', { used: formatSize(quota.used) })}
      </p>
      {quota.entitlementQuota > 0 && (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {t('quota.cloudStorageEntitlement', { amount: formatSize(quota.entitlementQuota) })}
        </p>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-sidebar-foreground">
        <Activity className="h-3.5 w-3.5" />
        <span>{t('quota.traffic')}</span>
        {trafficPercent !== null && (
          <span
            className={
              trafficBlocked ? 'ml-auto tabular-nums text-destructive' : 'ml-auto tabular-nums text-muted-foreground'
            }
          >
            {trafficPercent}%
          </span>
        )}
      </div>
      {quota.trafficQuota > 0 && (
        <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-border">
          <div
            className={
              trafficBlocked
                ? 'h-full rounded-full bg-destructive transition-all'
                : 'h-full rounded-full bg-primary transition-all'
            }
            style={{ width: `${Math.min(100, (quota.trafficUsed / quota.trafficQuota) * 100)}%` }}
          />
        </div>
      )}
      <p
        className={
          trafficBlocked ? 'text-xs text-destructive tabular-nums' : 'text-xs text-muted-foreground tabular-nums'
        }
      >
        {quota.trafficQuota > 0
          ? t('quota.trafficUsage', {
              used: formatSize(quota.trafficUsed),
              total: formatSize(quota.trafficQuota),
              period: quota.trafficPeriod,
            })
          : t('quota.trafficUsageNoLimit', { used: formatSize(quota.trafficUsed), period: quota.trafficPeriod })}
      </p>
      {purchasedBytes > 0 && (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {t('quota.purchased', { amount: formatSize(purchasedBytes) })}
        </p>
      )}
      {purchasedTrafficBytes > 0 && (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {t('quota.purchasedTraffic', { amount: formatSize(purchasedTrafficBytes) })}
        </p>
      )}
    </Link>
  )
}
