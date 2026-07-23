import { isPersonalOrgLike } from '@shared/org-slugs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Outlet, useParams } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/page-header'
import { PageTabs } from '@/components/layout/page-tabs'
import { authClient, setActive, useActiveOrganization } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/teams/$teamId')({
  component: TeamLayout,
})

type FullOrganization = {
  id: string
  name: string
  slug: string
  metadata?: Record<string, unknown> | string | null
  members: Array<{ userId: string; role: string }>
}

function TeamLayout() {
  const { t } = useTranslation()
  const { teamId } = useParams({ from: '/_authenticated/teams/$teamId' })
  const { data: activeOrg, isPending: activeOrgPending } = useActiveOrganization()
  const queryClient = useQueryClient()

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

  const workspaceSync = useMutation({
    mutationFn: async () => {
      const { error: setActiveError } = await setActive({ organizationId: teamId })
      if (setActiveError) throw setActiveError
      await queryClient.invalidateQueries({ queryKey: ['objects'] })
    },
  })

  useEffect(() => {
    if (!org || activeOrgPending || activeOrg?.id === teamId || workspaceSync.isPending) return
    workspaceSync.mutate()
  }, [activeOrg?.id, activeOrgPending, org, teamId, workspaceSync])

  const isPersonal = org ? isPersonalOrgLike(org) : false
  const workspaceMismatch = activeOrg?.id !== teamId

  if (isPending || activeOrgPending || (!!org && workspaceMismatch && !workspaceSync.error)) {
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

  if (error || workspaceSync.error || !org) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {t('teams.loadError')}
      </div>
    )
  }

  const allTabs = [
    {
      to: '/teams/$teamId/settings',
      params: { teamId },
      label: t('teams.tabSettings'),
    },
    { to: '/teams/$teamId/members', params: { teamId }, label: t('teams.tabMembers'), hidden: isPersonal },
    { to: '/teams/$teamId/ihost', params: { teamId }, label: t('settings.tabImageHosting') },
    { to: '/teams/$teamId/activity', params: { teamId }, label: t('teams.tabActivity') },
  ]
  const tabs = allTabs.filter((item) => !item.hidden)

  return (
    <div className="space-y-4">
      <PageHeader
        items={[
          {
            label: t('org.workspaceSettings'),
            icon: <Settings className="size-4 text-muted-foreground" />,
          },
          { label: org.name },
        ]}
      />

      <div className="border-b">
        <PageTabs items={tabs} />
      </div>

      <Outlet />
    </div>
  )
}
