import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HardDrive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUserQuota, listCloudOrders, listCloudProducts } from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / 1024 ** i
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

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
    queryFn: () => listCloudOrders(workspaceId),
    enabled: enabled && packagesQuery.isSuccess,
  })

  if (!quota) return null

  const purchasedBytes = (orders?.items ?? [])
    .filter((order) => order.paymentStatus === 'paid')
    .reduce((sum, order) => sum + (order.items[0]?.fulfillmentPayload.storageBytes ?? 0), 0)
  return (
    <Link
      to="/storage"
      className="block border-t px-5 py-3 text-sidebar-foreground transition-colors hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring active:bg-sidebar-hover"
      aria-label={t('quota.storage')}
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-sidebar-foreground">
        <HardDrive className="h-3.5 w-3.5" />
        <span>{t('quota.storage')}</span>
        {quota.quota > 0 && (
          <span className="ml-auto tabular-nums text-muted-foreground">
            {Math.round((quota.used / quota.quota) * 100)}%
          </span>
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
      {purchasedBytes > 0 && (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {t('quota.purchased', { amount: formatSize(purchasedBytes) })}
        </p>
      )}
    </Link>
  )
}
