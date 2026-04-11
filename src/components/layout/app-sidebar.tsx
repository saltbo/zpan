import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ChevronRight,
  FileText,
  FolderOpen,
  HardDrive,
  Image,
  LogOut,
  Music,
  Settings,
  ShieldCheck,
  Trash2,
  Video,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useSiteOptions } from '@/hooks/use-site-options'
import { getUserQuota } from '@/lib/api'
import { signOut, useSession } from '@/lib/auth-client'
import { FolderTree } from './folder-tree'

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / 1024 ** i
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
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
  const { data: session } = useSession()
  const { siteName } = useSiteOptions()
  const user = session?.user as { name: string; role?: string } | undefined
  const isAdmin = user?.role === 'admin'
  const { data: quota } = useQuery({
    queryKey: ['user', 'quota'],
    queryFn: getUserQuota,
    enabled: !!session,
  })

  async function handleSignOut() {
    await signOut()
    navigate({ to: '/sign-in' })
  }

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          <span className="text-lg font-semibold">{siteName || 'ZPan'}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible defaultOpen className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton asChild>
                      <Link to="/files">
                        <FolderOpen className="h-4 w-4" />
                        <span>{t('nav.files')}</span>
                        <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                      </Link>
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <FolderTree />
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/files" search={{ type: 'photos' }}>
                    <Image className="h-4 w-4" />
                    <span>{t('nav.photos')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/files" search={{ type: 'videos' }}>
                    <Video className="h-4 w-4" />
                    <span>{t('nav.videos')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/files" search={{ type: 'music' }}>
                    <Music className="h-4 w-4" />
                    <span>{t('nav.music')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/files" search={{ type: 'documents' }}>
                    <FileText className="h-4 w-4" />
                    <span>{t('nav.documents')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/recycle-bin">
                    <Trash2 className="h-4 w-4" />
                    <span>{t('nav.recycleBin')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {quota && (
        <div className="border-t px-4 py-3">
          {quota.quota > 0 && (
            <div className="mb-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (quota.used / quota.quota) * 100)}%` }}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {quota.quota > 0
              ? t('quota.usage', { used: formatSize(quota.used), total: formatSize(quota.quota) })
              : t('quota.usageNoLimit', { used: formatSize(quota.used) })}
          </p>
        </div>
      )}
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
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings className="mr-2 h-4 w-4" />
                {t('nav.settings')}
              </Link>
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem asChild>
                <Link to="/admin/storages">
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {t('nav.adminPanel')}
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
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
