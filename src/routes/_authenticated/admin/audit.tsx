import type { AdminAuditEvent } from '@shared/types'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActorIdentity, auditEventActor } from '@/components/actor-identity'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import {
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_FILTER_ALL,
  AUDIT_PAGE_SIZE_OPTIONS,
  AuditLogFilters,
  type AuditTimeRange,
  auditActionToFilter,
  auditTimeRangeToFilter,
} from '@/components/admin/audit-log-controls'
import { CursorPagination } from '@/components/list/cursor-pagination'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Card } from '@/components/ui/card'
import { useCursorPager, useStepBackFromEmptyPage } from '@/hooks/use-cursor-pager'
import { useEntitlement } from '@/hooks/useEntitlement'
import { type AdminAuditFilter, listAdminAuditLogs } from '@/lib/api'

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
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ActorIdentity actor={auditEventActor(event)} />
          <span className="text-muted-foreground">{metaDetail(event, t)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {event.orgName && <span className="mr-1">{event.orgName} ·</span>}
          {relativeTime(createdAt)}
        </p>
      </div>
    </div>
  )
}

function AuditLogsPage() {
  const { t } = useTranslation()
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const auditEnabled = hasFeature('audit_log')
  const [pageSize, setPageSize] = useState(AUDIT_DEFAULT_PAGE_SIZE)
  const [action, setAction] = useState(AUDIT_FILTER_ALL)
  const [timeRange, setTimeRange] = useState<AuditTimeRange>('all')

  const filter = useMemo<AdminAuditFilter>(() => {
    const auditAction = auditActionToFilter(action)
    return {
      ...(auditAction ? { action: auditAction } : {}),
      ...auditTimeRangeToFilter(timeRange),
    }
  }, [action, timeRange])

  const pager = useCursorPager(`${pageSize}:${action}:${timeRange}`)

  const { data, isFetching, isPlaceholderData, isPending, error } = useQuery({
    queryKey: ['admin', 'audit', pageSize, action, timeRange, pager.pageToken],
    queryFn: () => listAdminAuditLogs({ pageToken: pager.pageToken, pageSize }, filter),
    placeholderData: keepPreviousData,
    enabled: auditEnabled,
  })
  useStepBackFromEmptyPage(pager, { data, isFetching, isPlaceholderData })

  const items = data?.items ?? []

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.audit.title')}
        description={t('admin.audit.description')}
        badge={<ProBadge tooltip={t('admin.audit.proTooltip')} />}
      />

      {entitlementLoading ? null : !auditEnabled ? (
        <UpgradeHint
          feature="audit_log"
          title={t('admin.audit.upgradeTitle')}
          description={t('admin.audit.upgradeDescription')}
          actionLabel={t('admin.audit.upgradeButton')}
        />
      ) : (
        <div className="space-y-4">
          <AuditLogFilters
            action={action}
            timeRange={timeRange}
            disabled={isFetching}
            onActionChange={setAction}
            onTimeRangeChange={setTimeRange}
          />

          {isPending ? (
            <div className="space-y-3" role="status">
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
          ) : items.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
              {t('admin.audit.empty')}
            </div>
          ) : (
            <Card className="gap-0 divide-y px-4 py-0 shadow-none">
              {items.map((event) => (
                <AuditRow key={event.id} event={event} />
              ))}
            </Card>
          )}

          {!isPending && !error && (
            <CursorPagination
              pageSize={pageSize}
              pageSizeOptions={AUDIT_PAGE_SIZE_OPTIONS}
              hasPrevious={pager.hasPrevious}
              nextPageToken={data?.nextPageToken}
              disabled={isFetching}
              onPageSizeChange={setPageSize}
              onPrevious={pager.previous}
              onNext={pager.next}
            />
          )}
        </div>
      )}
    </div>
  )
}
