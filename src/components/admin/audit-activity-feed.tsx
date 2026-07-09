import type { AdminAuditEvent } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { getInitials } from '@/lib/format'

export function AdminAuditActivityFeed({
  events,
  isLoading,
  isError,
}: {
  events: AdminAuditEvent[]
  isLoading: boolean
  isError: boolean
}) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="space-y-3" role="status">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 py-3">
            <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {t('activity.loadError')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {events.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('activity.empty')}
        </div>
      ) : (
        <div className="divide-y rounded-md border px-4">
          {events.map((event) => (
            <AdminAuditActivityItem key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

function AdminAuditActivityItem({ event }: { event: AdminAuditEvent }) {
  const { t } = useTranslation()
  const metadata = parseActivityMetadata(event.metadata)
  const status = metadata?.status ?? metadata?.result
  const metadataDetails = metadata
    ? Object.entries(metadata).filter(([key, value]) => !['status', 'result', 'from', 'to'].includes(key) && value)
    : []
  const targetName = event.targetName || event.targetId || event.targetType
  const actorLabel = event.user.name || formatActor(event)

  return (
    <div className="flex items-start gap-3 py-3">
      <Avatar className="h-8 w-8 flex-shrink-0">
        {event.user.image && <AvatarImage src={event.user.image} alt={event.user.name} />}
        <AvatarFallback className="text-xs">{getInitials(actorLabel)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(`activity.action.${event.action}`, { defaultValue: event.action })}</Badge>
          {status && <Badge variant="outline">{status}</Badge>}
          <span className="min-w-0 truncate text-sm font-medium" title={targetName}>
            {t(`activity.target.${event.targetType}`, { defaultValue: event.targetType })}: {targetName}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{formatTimestamp(event.createdAt)}</span>
          {event.orgName && <span>{event.orgName}</span>}
          {event.targetId && <span>{event.targetId}</span>}
        </div>
        {metadata && (metadata.from || metadata.to || metadataDetails.length > 0) && (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {metadata.from && (
              <span>
                {t('activity.meta.from')}: {metadata.from}
              </span>
            )}
            {metadata.to && (
              <span>
                {t('activity.meta.to')}: {metadata.to}
              </span>
            )}
            {metadataDetails.map(([key, value]) => (
              <span key={key}>
                {key}: {value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function formatActor(event: AdminAuditEvent): string {
  if (event.userId) return event.userId
  if (event.actorType === 'anonymous') return 'Anonymous'
  if (event.actorType === 'system') return event.actorRef ? `System:${event.actorRef}` : 'System'
  if (event.actorType === 'downloader') return event.actorRef ? `Downloader:${event.actorRef}` : 'Downloader'
  return 'Unknown'
}

function parseActivityMetadata(metadata: string | null): Record<string, string> | null {
  if (!metadata) return null

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, formatMetadataValue(value)]))
  } catch {
    return null
  }
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
