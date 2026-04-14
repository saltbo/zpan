import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setActive, useActiveOrganization, useListOrganizations, useSession } from '@/lib/auth-client'

type Organization = {
  id: string
  name: string
  slug: string
  logo?: string | null
  metadata?: Record<string, unknown>
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function OrgSwitcher() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const { data: orgs } = useListOrganizations()
  const queryClient = useQueryClient()

  const allOrgs = (orgs ?? []) as Organization[]
  const personalOrg = allOrgs.find((o) => o.slug.startsWith('personal-'))
  const teams = allOrgs.filter((o) => !o.slug.startsWith('personal-'))

  const isPersonal = !activeOrg || activeOrg.id === personalOrg?.id
  const displayName = isPersonal ? session?.user?.name : activeOrg?.name

  async function handleSwitch(orgId: string) {
    const { error } = await setActive({ organizationId: orgId })
    if (error) {
      toast.error(error.message)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['objects'] })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
          <Avatar size="sm">
            {!isPersonal && activeOrg?.logo ? <AvatarImage src={activeOrg.logo} alt={activeOrg.name} /> : null}
            <AvatarFallback>
              {isPersonal ? getInitials(session?.user?.name || '?') : getInitials(activeOrg?.name || '?')}
            </AvatarFallback>
          </Avatar>
          <span className="flex-1 truncate text-left font-medium">{displayName || t('org.mySpace')}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('org.switchWorkspace')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {personalOrg && (
          <DropdownMenuItem onClick={() => handleSwitch(personalOrg.id)} className="gap-2">
            <Avatar size="sm">
              <AvatarFallback>{getInitials(session?.user?.name || '?')}</AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate">{session?.user?.name || t('org.mySpace')}</span>
            {isPersonal && <Check className="h-4 w-4 shrink-0" />}
          </DropdownMenuItem>
        )}
        {teams.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {teams.map((org) => (
              <DropdownMenuItem key={org.id} onClick={() => handleSwitch(org.id)} className="gap-2">
                <Avatar size="sm">
                  {org.logo ? <AvatarImage src={org.logo} alt={org.name} /> : null}
                  <AvatarFallback>{getInitials(org.name)}</AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate">{org.name}</span>
                {activeOrg?.id === org.id && <Check className="h-4 w-4 shrink-0" />}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
