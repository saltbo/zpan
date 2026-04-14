import type { ActivityEvent } from '@shared/types'
import { useInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { listTeamActivities } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/teams/$teamId/activity')({
  component: TeamActivityPage,
})

function relativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 30) return `${diffDay} days ago`
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

function ActivityItem({ event }: { event: ActivityEvent }) {
  const { t } = useTranslation()

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
      // ignore malformed metadata
    }
  }

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
          <span className="text-muted-foreground">{detail}</span>
        </p>
        <p className="text-xs text-muted-foreground">{relativeTime(createdAt)}</p>
      </div>
    </div>
  )
}

function TeamActivityPage() {
  const { t } = useTranslation()
  const { teamId } = Route.useParams()

  const PAGE_SIZE = 20

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, error } = useInfiniteQuery({
    queryKey: ['team-activity', teamId],
    queryFn: ({ pageParam = 1 }) => listTeamActivities(teamId, pageParam as number, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = (lastPage.page - 1) * lastPage.pageSize + lastPage.items.length
      return loaded < lastPage.total ? lastPage.page + 1 : undefined
    },
  })

  const allItems = data?.pages.flatMap((p) => p.items) ?? []

  if (isPending) {
    return (
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
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {t('activity.loadError')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">{t('activity.title')}</h2>

      {allItems.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('activity.empty')}
        </div>
      ) : (
        <div className="divide-y rounded-md border px-4">
          {allItems.map((event) => (
            <ActivityItem key={event.id} event={event} />
          ))}
        </div>
      )}

      {hasNextPage && (
        <div className="pt-2 text-center">
          <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? '...' : t('activity.loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}
