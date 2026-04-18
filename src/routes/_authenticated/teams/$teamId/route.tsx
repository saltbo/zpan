import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useParams, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { authClient, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/teams/$teamId')({
  component: TeamLayout,
})

type FullOrganization = {
  id: string
  name: string
  members: Array<{ userId: string; role: string }>
}

function tabClass(isActive: boolean): string {
  return isActive
    ? 'border-b-2 border-primary -mb-px px-4 py-2 text-sm font-medium text-foreground'
    : 'border-b-2 border-transparent -mb-px px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
}

function TeamLayout() {
  const { t } = useTranslation()
  const { teamId } = useParams({ from: '/_authenticated/teams/$teamId' })
  const { data: session } = useSession()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const {
    data: org,
    isPending,
    error,
  } = useQuery({
    queryKey: ['organization', teamId],
    queryFn: async () => {
      const { data, error: err } = await authClient.organization.getFullOrganization({
        query: { organizationId: teamId },
      })
      if (err) throw err
      return data as FullOrganization | null
    },
    enabled: !!teamId,
  })

  const userId = session?.user?.id ?? ''
  const myMembership = org?.members.find((m) => m.userId === userId)
  const isOwner = myMembership?.role === 'owner'

  if (isPending) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-10 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !org) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {t('teams.loadError')}
      </div>
    )
  }

  const membersPath = `/teams/${teamId}/members`
  const activityPath = `/teams/${teamId}/activity`
  const settingsPath = `/teams/${teamId}/settings`

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{org.name}</h2>

      <div className="border-b">
        <nav className="flex gap-1" aria-label="Team navigation">
          <Link to="/teams/$teamId/members" params={{ teamId }} className={tabClass(pathname === membersPath)}>
            {t('teams.tabMembers')}
          </Link>
          <Link to="/teams/$teamId/activity" params={{ teamId }} className={tabClass(pathname === activityPath)}>
            {t('teams.tabActivity')}
          </Link>
          {isOwner && (
            <Link to="/teams/$teamId/settings" params={{ teamId }} className={tabClass(pathname === settingsPath)}>
              {t('teams.tabSettings')}
            </Link>
          )}
        </nav>
      </div>

      <Outlet />
    </div>
  )
}
