import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { openAnnouncementsDialog } from '@/components/announcements/site-announcements'
import { Button } from '@/components/ui/button'
import { DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getUnreadCount, listNotifications, markAllNotificationsRead } from '@/lib/api'
import { NotificationItem } from './notification-item'

export function NotificationDropdown() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { hasFeature } = useEntitlement()
  const announcementsEnabled = hasFeature('site_announcements')

  const { data } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => listNotifications(1, 10),
  })

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCount,
  })

  const items = data?.items ?? []
  const hasUnread = (unread?.count ?? 0) > 0

  async function handleMarkAllRead() {
    await markAllNotificationsRead()
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  function handleItemRead() {
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <DropdownMenuContent align="end" className="w-80 p-0">
      <div className="flex items-center justify-between px-4 py-3">
        <DropdownMenuLabel className="p-0 text-sm font-semibold">{t('notification.title')}</DropdownMenuLabel>
        {hasUnread && (
          <Button variant="ghost" size="sm" className="h-auto py-0 px-1 text-xs" onClick={handleMarkAllRead}>
            {t('notification.markAllRead')}
          </Button>
        )}
      </div>
      <DropdownMenuSeparator className="m-0" />
      <div className="max-h-80 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('notification.empty')}</p>
        ) : (
          items.map((item) => <NotificationItem key={item.id} notification={item} onRead={handleItemRead} />)
        )}
      </div>
      {announcementsEnabled && (
        <>
          <DropdownMenuSeparator className="m-0" />
          <Button
            variant="ghost"
            className="h-10 w-full justify-start rounded-none px-4 text-sm"
            onClick={openAnnouncementsDialog}
          >
            {t('announcement.title')}
          </Button>
        </>
      )}
    </DropdownMenuContent>
  )
}
