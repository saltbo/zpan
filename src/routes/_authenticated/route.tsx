import { createFileRoute, Outlet, redirect, useMatchRoute } from '@tanstack/react-router'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { GlobalSearchBar } from '@/components/layout/global-search-bar'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <GlobalSearchBar />
          <div className="ml-auto flex items-center">
            <NotificationBell />
          </div>
        </header>
        <div className="min-w-0 flex-1 bg-canvas p-4">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
