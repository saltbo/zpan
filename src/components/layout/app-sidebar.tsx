import { DEFAULT_SITE_NAME } from '@shared/constants'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  Image,
  ListChecks,
  Music,
  Share2,
  Trash2,
  Video,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useBranding } from '@/components/branding/BrandingProvider'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
import { useSiteConfig } from '@/hooks/use-site-config'
import { getIhostConfig, listBackgroundJobs } from '@/lib/api'
import { useActiveOrganization, useSession } from '@/lib/auth-client'
import { OrgSwitcher } from '../team/org-switcher'
import { FolderTree } from './folder-tree'
import { QuotaPanel } from './quota-panel'
import { UserAccountMenu } from './user-account-menu'

export function AppSidebar() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const { data: siteConfig } = useSiteConfig()
  const siteName = siteConfig?.site.name ?? DEFAULT_SITE_NAME
  const { branding } = useBranding()
  const { data: ihostConfig } = useQuery({
    queryKey: ['ihost', 'config', activeOrg?.id],
    queryFn: getIhostConfig,
    enabled: !!session,
  })
  const { data: activeTaskCount = 0 } = useQuery({
    queryKey: ['background-jobs', 'active-count'],
    queryFn: async () => {
      const [queued, running] = await Promise.all([
        listBackgroundJobs({ status: 'queued', page: 1, pageSize: 1 }),
        listBackgroundJobs({ status: 'running', page: 1, pageSize: 1 }),
      ])
      return queued.total + running.total
    },
    enabled: !!session,
  })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const fileType = useRouterState({ select: (s) => (s.location.search as { type?: string })?.type })
  const isFiles = pathname === '/files'
  const activeFilesNav = isFiles && !fileType
  const activeFileType = (type: string) => isFiles && fileType === type
  const activeRecycleBin = pathname === '/trash'
  const activeShares = pathname.startsWith('/shares')
  const activeDownloads = pathname.startsWith('/downloads')
  const activeTasks = pathname.startsWith('/tasks')
  const activeImageHost = pathname === '/image-host'

  return (
    <Sidebar>
      <SidebarHeader className="gap-2 px-3 pt-3 pb-1">
        <div className="-mx-3 flex items-center gap-2.5 border-b px-4 pb-3">
          <img src={branding.logo_url ?? '/logo.png'} alt={siteName} className="size-8" />
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
                  <Link to="/shares" search={{ status: 'all', page: 1, box: 'sent' }}>
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
              <SidebarSeparator />
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={activeDownloads}>
                  <Link to="/downloads">
                    <Download className="h-4 w-4" />
                    <span>{t('nav.downloads')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={activeTasks}>
                  <Link to="/tasks">
                    <ListChecks className="h-4 w-4" />
                    <span>{t('nav.tasks')}</span>
                    {activeTaskCount > 0 && (
                      <Badge className="ml-auto h-5 min-w-5 rounded-full px-1.5 text-[10px]">
                        {activeTaskCount > 99 ? '99+' : activeTaskCount}
                      </Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {ihostConfig?.enabled && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={activeImageHost}>
                    <Link to="/image-host">
                      <Image className="h-4 w-4" />
                      <span>{t('nav.imageHost')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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
              <UserAccountMenu showAdminLink showFrontendLinks />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
