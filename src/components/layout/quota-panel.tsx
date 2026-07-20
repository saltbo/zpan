import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HardDrive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserQuota } from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'
import { formatSize } from '@/lib/format'

export function QuotaPanel({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation()
  const { data: activeOrg } = useActiveOrganization()
  const workspaceId = activeOrg?.id ?? 'personal'
  const { data: quota, isLoading } = useQuery({
    queryKey: ['user', 'quota', workspaceId],
    queryFn: getUserQuota,
    enabled,
  })

  if (!enabled) return null

  const storagePercent = quota && quota.quota > 0 ? Math.round((quota.used / quota.quota) * 100) : null

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
      {quota && quota.quota > 0 && (
        <div className="mb-1.5 h-2 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(100, (quota.used / quota.quota) * 100)}%` }}
          />
        </div>
      )}
      {quota ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {quota.quota > 0
            ? t('quota.usage', { used: formatSize(quota.used), total: formatSize(quota.quota) })
            : t('quota.usageInvalid', { used: formatSize(quota.used) })}
        </p>
      ) : (
        <Skeleton className={isLoading ? 'h-3 w-24' : 'h-3 w-16 opacity-50'} />
      )}
    </Link>
  )
}
