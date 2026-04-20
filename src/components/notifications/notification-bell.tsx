import { useQuery } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { getUnreadCount } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { NotificationDropdown } from './notification-dropdown'

const UNREAD_POLL_INTERVAL = 30_000

export function NotificationBell() {
  const { data: session } = useSession()

  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCount,
    enabled: !!session,
    refetchInterval: UNREAD_POLL_INTERVAL,
  })

  const count = data?.count ?? 0
  const displayCount = count > 9 ? '9+' : count > 0 ? String(count) : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {displayCount && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[10px] font-bold text-destructive-foreground leading-none">
              {displayCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <NotificationDropdown />
    </DropdownMenu>
  )
}
