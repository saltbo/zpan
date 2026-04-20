import type { Notification } from '@shared/types'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { markNotificationRead } from '@/lib/api'

function diffMinutes(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000)
}

function resolveHref(notification: Notification): string | null {
  if (notification.refType === 'share' && notification.metadata) {
    try {
      const meta = JSON.parse(notification.metadata) as { token?: string }
      if (meta.token) return `/s/${meta.token}`
    } catch {
      // ignore malformed metadata
    }
  }
  return null
}

interface NotificationItemProps {
  notification: Notification
  onRead: () => void
}

export function NotificationItem({ notification, onRead }: NotificationItemProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isUnread = !notification.readAt
  const href = resolveHref(notification)

  function relativeTime(): string {
    const mins = diffMinutes(notification.createdAt)
    if (mins < 1) return t('notification.justNow')
    if (mins < 60) return t('notification.minutesAgo', { count: mins })
    const hours = Math.floor(mins / 60)
    if (hours < 24) return t('notification.hoursAgo', { count: hours })
    return t('notification.daysAgo', { count: Math.floor(hours / 24) })
  }

  async function handleClick() {
    if (isUnread) {
      await markNotificationRead(notification.id).catch(() => undefined)
      onRead()
    }
    if (href) navigate({ to: href })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full text-left px-4 py-3 hover:bg-accent transition-colors ${isUnread ? 'bg-accent/30' : ''}`}
    >
      <div className="flex items-start gap-2">
        {isUnread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
        {!isUnread && <span className="mt-1.5 h-2 w-2 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className={`text-sm truncate ${isUnread ? 'font-semibold' : 'font-medium'}`}>{notification.title}</p>
          {notification.body && <p className="text-xs text-muted-foreground truncate">{notification.body}</p>}
          <p className="text-xs text-muted-foreground mt-0.5">{relativeTime()}</p>
        </div>
      </div>
    </button>
  )
}
