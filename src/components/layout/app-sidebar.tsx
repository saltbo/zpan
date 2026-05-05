import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  ChevronRight,
  ChevronsUpDown,
  FileText,
  FolderOpen,
  Image,
  LogOut,
  Music,
  Settings,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
  Video,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useBranding } from '@/components/branding/BrandingProvider'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { useSiteOptions } from '@/hooks/use-site-options'
import { getIhostConfig } from '@/lib/api'
import { signOut, useActiveOrganization, useSession } from '@/lib/auth-client'
import { OrgSwitcher } from '../team/org-switcher'
import { FolderTree } from './folder-tree'
import { QuotaPanel } from './quota-panel'

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
  const { data: activeOrg } = useActiveOrganization()
  const { siteName } = useSiteOptions()
  const { branding } = useBranding()
  const user = session?.user as { name: string; username?: string; role?: string; image?: string | null } | undefined
  const isAdmin = user?.role === 'admin'
  const { data: ihostConfig } = useQuery({
    queryKey: ['ihost', 'config', activeOrg?.id],
    queryFn: getIhostConfig,
    enabled: !!session,
  })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const fileType = useRouterState({ select: (s) => (s.location.search as { type?: string })?.type })
  const isFiles = pathname === '/files'
  const activeFilesNav = isFiles && !fileType
  const activeFileType = (type: string) => isFiles && fileType === type
  const activeRecycleBin = pathname === '/trash'
  const activeShares = pathname.startsWith('/shares')
  const activeImageHost = pathname === '/image-host'

  async function handleSignOut() {
    await signOut()
    navigate({ to: '/sign-in' })
  }

  return (
    <Sidebar>
      <SidebarHeader className="gap-2 px-3 pt-3 pb-1">
        <div className="-mx-3 flex items-center gap-2.5 border-b px-4 pb-3">
          <img src={branding.logo_url ?? '/logo.svg'} alt={siteName} className="size-8" />
          <span className="text-lg font-semibold">{siteName}</span>
        </div>
        <OrgSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-3">
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible defaultOpen className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton asChild isActive={activeFilesNav}>
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
                <SidebarMenuButton asChild isActive={activeFileType('photos')}>
                  <Link to="/files" search={{ type: 'photos' }}>
                    <Image className="h-4 w-4" />
                    <span>{t('nav.photos')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={activeFileType('videos')}>
                  <Link to="/files" search={{ type: 'videos' }}>
                    <Video className="h-4 w-4" />
                    <span>{t('nav.videos')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={activeFileType('music')}>
                  <Link to="/files" search={{ type: 'music' }}>
                    <Music className="h-4 w-4" />
                    <span>{t('nav.music')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={activeFileType('documents')}>
                  <Link to="/files" search={{ type: 'documents' }}>
                    <FileText className="h-4 w-4" />
                    <span>{t('nav.documents')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={activeShares}>
                  <Link to="/shares" search={{ status: 'all', page: 1 }}>
                    <Share2 className="h-4 w-4" />
                    <span>{t('nav.shares')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={activeRecycleBin}>
                  <Link to="/trash">
                    <Trash2 className="h-4 w-4" />
                    <span>{t('nav.trash')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {ihostConfig?.enabled && (
                <>
                  <SidebarSeparator />
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={activeImageHost}>
                      <Link to="/image-host">
                        <Image className="h-4 w-4" />
                        <span>{t('nav.imageHost')}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {!branding.hide_powered_by && (
        <div className="px-4 py-1 text-center text-[10px] text-muted-foreground/30">
          Powered by{' '}
          <a
            href="https://github.com/saltbo/zpan"
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline hover:underline hover:text-muted-foreground/50 transition-colors"
          >
            ZPan
          </a>
        </div>
      )}
      <QuotaPanel enabled={!!session} />
      <SidebarFooter className="border-t p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="flex-1 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                    <Avatar size="sm">
                      {user?.image && <AvatarImage src={user.image} alt={user.name || user.username || ''} />}
                      <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                        {user ? getInitials(user.name || user.username || '?') : '?'}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate text-left font-medium">{user?.name || user?.username}</span>
                    <ChevronsUpDown className="ml-auto size-4 opacity-60" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuItem asChild>
                    <Link to="/settings">
                      <Settings className="mr-2 h-4 w-4" />
                      {t('nav.settings')}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/teams">
                      <Users className="mr-2 h-4 w-4" />
                      {t('nav.teams')}
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
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
