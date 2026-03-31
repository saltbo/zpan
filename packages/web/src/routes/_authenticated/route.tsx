import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const res = await fetch('/api/auth/get-session', { credentials: 'include' })
    if (!res.ok) throw redirect({ to: '/sign-in' })
    const data = await res.json()
    if (!data?.session) throw redirect({ to: '/sign-in' })
    return { user: data.user }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">ZPan</span>
        </header>
        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
