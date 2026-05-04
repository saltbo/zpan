import type { AdminAuditEvent } from '@shared/types'
import { useInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ProBadge } from '@/components/ProBadge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useEntitlement } from '@/hooks/useEntitlement'
import { listAdminAuditLogs } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/audit')({
  component: AuditLogsPage,
})

function relativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  const diffMs = Date.now() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 30) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

function userInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function metaDetail(event: AdminAuditEvent, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const actionLabel = t(`activity.action.${event.action}`, { defaultValue: event.action })
  const targetTypeLabel = t(`activity.target.${event.targetType}`, { defaultValue: event.targetType })
  let detail = `${actionLabel} ${targetTypeLabel} "${event.targetName}"`
  if (event.metadata) {
    try {
      const meta = JSON.parse(event.metadata) as Record<string, string>
      if (event.action === 'rename' && meta.from) {
        detail += ` (${t('activity.meta.from')} "${meta.from}")`
      } else if (event.action === 'move' && meta.to) {
        detail += ` ${t('activity.meta.to')} ${meta.to}`
      }
    } catch {
      // ignore
    }
  }
  return detail
}

function AuditRow({ event }: { event: AdminAuditEvent }) {
  const { t } = useTranslation()
  const createdAt = new Date(event.createdAt as unknown as string | number)
  return (
    <div className="flex items-start gap-3 py-3">
      <Avatar className="h-8 w-8 flex-shrink-0">
        {event.user.image && <AvatarImage src={event.user.image} alt={event.user.name} />}
        <AvatarFallback className="text-xs">{userInitials(event.user.name || '?')}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">{event.user.name || event.userId}</span>{' '}
          <span className="text-muted-foreground">{metaDetail(event, t)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {event.orgName && <span className="mr-1">{event.orgName} ·</span>}
          {relativeTime(createdAt)}
        </p>
      </div>
    </div>
  )
}

function UpgradePrompt() {
  const { t } = useTranslation()
  return (
    <Card className="border-dashed">
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="rounded-2xl border border-border/60 bg-primary/10 p-3 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold">{t('admin.audit.upgradeTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('admin.audit.upgradeDescription')}</p>
        </div>
        <Button asChild style={{ backgroundColor: '#1A73E8' }}>
          <Link to="/admin/licensing">{t('admin.audit.upgradeButton')}</Link>
        </Button>
      </div>
    </Card>
  )
}

const PAGE_SIZE = 20

function AuditLogsPage() {
  const { t } = useTranslation()
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const auditEnabled = hasFeature('audit_log')

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, error } = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam = 1 }) => listAdminAuditLogs(pageParam as number, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = (lastPage.page - 1) * lastPage.pageSize + lastPage.items.length
      return loaded < lastPage.total ? lastPage.page + 1 : undefined
    },
    enabled: auditEnabled,
  })

  const allItems = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold">{t('admin.audit.title')}</h2>
        {!entitlementLoading && !auditEnabled && <ProBadge tooltip={t('admin.audit.proTooltip')} />}
      </div>

      <p className="text-sm text-muted-foreground">{t('admin.audit.description')}</p>

      {entitlementLoading ? null : !auditEnabled ? (
        <UpgradePrompt />
      ) : isPending ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-start gap-3 py-3">
              <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {t('admin.audit.loadError')}
        </div>
      ) : allItems.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('admin.audit.empty')}
        </div>
      ) : (
        <>
          <Card className="gap-0 divide-y px-4 py-0 shadow-none">
            {allItems.map((event) => (
              <AuditRow key={event.id} event={event} />
            ))}
          </Card>
          {hasNextPage && (
            <div className="pt-2 text-center">
              <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? '...' : t('admin.audit.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
