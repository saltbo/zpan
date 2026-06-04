import { createFileRoute, Outlet, redirect, useMatchRoute } from '@tanstack/react-router'
import { SiteAnnouncements } from '@/components/announcements/site-announcements'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { GlobalSearchBar } from '@/components/layout/global-search-bar'
import { MusicPlayerButton } from '@/components/music/music-player-button'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { UploadStatusButton } from '@/components/upload/upload-queue'
import { getSession } from '@/lib/api'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const data = await getSession()
    if (!data?.session) {
      const redirectUrl = encodeURIComponent(`${location.pathname}${location.searchStr ?? ''}`)
      throw redirect({ to: '/sign-in', search: { redirect: redirectUrl } as never })
    }
    return { user: data.user }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const matchRoute = useMatchRoute()
  const isAdmin = matchRoute({ to: '/admin', fuzzy: true })

  if (isAdmin) return <Outlet />

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="z-30 flex h-14 min-w-0 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SidebarTrigger className="-ml-1" />
          <GlobalSearchBar />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <UploadStatusButton />
            <MusicPlayerButton />
            <NotificationBell />
          </div>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-canvas p-4">
          <SiteAnnouncements />
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
