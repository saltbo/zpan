import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

export const Route = createFileRoute('/_authenticated/admin')({
  beforeLoad: async ({ context }) => {
    const { user } = context as { user: { role: string } }
    if (user.role !== 'admin') throw redirect({ to: '/files', search: { folder: '' } })
  },
  component: AdminLayout,
})

function AdminLayout() {
  const { t } = useTranslation()

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">{t('admin.title')}</span>
        </header>
        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
