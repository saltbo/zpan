import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageTabs } from '@/components/layout/page-tabs'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { authClient, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/teams/$teamId')({
  component: TeamLayout,
})

type FullOrganization = {
  id: string
  name: string
  members: Array<{ userId: string; role: string }>
}

function TeamLayout() {
  const { t } = useTranslation()
  const { teamId } = useParams({ from: '/_authenticated/teams/$teamId' })
  const { data: session } = useSession()

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

  const allTabs = [
    { to: '/teams/$teamId/members', params: { teamId }, label: t('teams.tabMembers') },
    { to: '/teams/$teamId/activity', params: { teamId }, label: t('teams.tabActivity') },
    { to: '/teams/$teamId/settings', params: { teamId }, label: t('teams.tabSettings'), hidden: !isOwner },
  ]
  const tabs = allTabs.filter((item) => !item.hidden)

  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/teams">{t('nav.teams')}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{org.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="border-b">
        <PageTabs items={tabs} />
      </div>

      <Outlet />
    </div>
  )
}
