import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  BadgeCheck,
  Database,
  KeyRound,
  LayoutDashboard,
  Mail,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

const adminNavItems = [
  { titleKey: 'admin.nav.overview', url: '/admin', icon: LayoutDashboard },
  { titleKey: 'admin.nav.users', url: '/admin/users', icon: Users },
  { titleKey: 'admin.nav.storages', url: '/admin/storages', icon: Database },
  { titleKey: 'admin.nav.auth', url: '/admin/settings/oauth', icon: KeyRound },
  { titleKey: 'admin.nav.email', url: '/admin/settings/email', icon: Mail },
  { titleKey: 'admin.nav.settings', url: '/admin/settings', icon: Settings },
  { titleKey: 'admin.nav.audit', url: '/admin/audit', icon: ShieldCheck },
  { titleKey: 'admin.nav.licensing', url: '/admin/licensing', icon: BadgeCheck },
]

export function AdminSidebar() {
  const { t } = useTranslation()

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">{t('admin.title')}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('admin.nav.management')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminNavItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{t(item.titleKey)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-2">
        <Button variant="ghost" className="w-full justify-start" asChild>
          <Link to="/files">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('admin.backToFiles')}
          </Link>
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
