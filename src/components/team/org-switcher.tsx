import { FREE_TEAM_LIMIT } from '@shared/constants'
import { isPersonalOrgLike } from '@shared/org-slugs'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Check, ChevronDown, Plus, Settings } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CreateTeamDialog, TeamLimitDialog } from '@/components/team/create-team-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { useEntitlement } from '@/hooks/useEntitlement'
import { setActive, useActiveOrganization, useListOrganizations } from '@/lib/auth-client'
import { getInitials } from '@/lib/format'

type Organization = {
  id: string
  name: string
  slug: string
  logo?: string | null
  metadata?: Record<string, unknown>
}

export function OrgSwitcher() {
  const { t } = useTranslation()
  const { data: activeOrg } = useActiveOrganization()
  const { data: orgs, isPending: orgsLoading } = useListOrganizations()
  const { hasFeature } = useEntitlement()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [createOpen, setCreateOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const allOrgs = (orgs ?? []) as Organization[]
  const personalOrg = allOrgs.find(isPersonalOrgLike)
  const activeOrgId = activeOrg?.id ?? personalOrg?.id
  const isAtLimit = !orgsLoading && !hasFeature('teams_unlimited') && allOrgs.length >= FREE_TEAM_LIMIT

  const isPersonal = !activeOrg || activeOrg.id === personalOrg?.id
  const personalName = personalOrg?.name || t('org.mySpace')
  const displayName = isPersonal ? personalName : activeOrg?.name

  async function handleSwitch(org: Organization) {
    const { error } = await setActive({ organizationId: org.id })
    if (error) {
      toast.error(error.message)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['objects'] })
    const isWorkspaceSettings = /^\/teams\/[^/]+\/(activity|billing|ihost|members|settings)$/.test(pathname)
    if (isWorkspaceSettings) {
      navigate({ to: '/teams/$teamId/settings', params: { teamId: org.id } })
      return
    }
    navigate({ to: '/files' })
  }

  function handleCreateTeam() {
    if (isAtLimit) {
      setUpgradeOpen(true)
      return
    }
    setCreateOpen(true)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="h-9 rounded-md border bg-background px-2 shadow-xs hover:bg-background hover:shadow-sm data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground data-[state=open]:shadow-sm">
              <Avatar size="sm">
                {!isPersonal && activeOrg?.logo ? <AvatarImage src={activeOrg.logo} alt={activeOrg.name} /> : null}
                <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                  {isPersonal ? getInitials(personalName) : getInitials(activeOrg?.name || '?')}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-left font-medium">{displayName || t('org.mySpace')}</span>
              <ChevronDown className="ml-auto mr-1 size-4 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {t('org.switchWorkspace')}
            </DropdownMenuLabel>
            <DropdownMenuGroup className="max-h-72 overflow-y-auto">
              {allOrgs.map((org) => {
                const selected = activeOrgId === org.id
                const name = isPersonalOrgLike(org) ? personalName : org.name
                return (
                  <DropdownMenuItem
                    key={org.id}
                    onClick={() => handleSwitch(org)}
                    className={selected ? 'gap-2 bg-accent/70' : 'gap-2'}
                  >
                    <Avatar size="sm">
                      {org.logo ? <AvatarImage src={org.logo} alt={org.name} /> : null}
                      <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                        {getInitials(name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate font-medium">{name}</span>
                    {selected && <Check className="size-4 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {activeOrgId && (
              <DropdownMenuItem asChild>
                <Link to="/teams/$teamId/settings" params={{ teamId: activeOrgId }}>
                  <Settings className="size-4" />
                  {t('org.workspaceSettings')}
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={handleCreateTeam}>
              <Plus className="size-4" />
              <span className="flex-1">{t('teams.createNew')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
        <TeamLimitDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
