import { Link, useNavigate } from '@tanstack/react-router'
import { FolderOpen, HardDrive, LogOut, Settings, ShieldCheck, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { signOut, useSession } from '@/lib/auth-client'
import { useSiteName } from '@/lib/site-options'

const navItems = {
  main: [
    { titleKey: 'nav.files', url: '/files', icon: FolderOpen },
    { titleKey: 'nav.recycleBin', url: '/recycle-bin', icon: Trash2 },
  ],
  secondary: [{ titleKey: 'nav.settings', url: '/settings', icon: Settings }],
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function AppSidebar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const siteName = useSiteName()
  const { data: session } = useSession()
  const user = session?.user as { name: string; role?: string } | undefined
  const isAdmin = user?.role === 'admin'

  async function handleSignOut() {
    await signOut()
    navigate({ to: '/sign-in' })
  }

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          <span className="text-lg font-semibold">{siteName}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.main')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.main.map((item) => (
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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.secondary.map((item) => (
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Avatar size="sm">
                <AvatarFallback>{user?.name ? getInitials(user.name) : '?'}</AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-left font-medium">{user?.name ?? ''}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            {isAdmin && (
              <>
                <DropdownMenuItem asChild>
                  <Link to="/admin/storages">
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    {t('nav.adminPanel')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              {t('auth.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
