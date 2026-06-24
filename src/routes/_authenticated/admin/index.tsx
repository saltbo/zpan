import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Database, Gauge, MailPlus, Settings, UserPlus, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { listQuotas, listSiteInvitations, listStorages } from '@/lib/api'
import { adminListUsers } from '@/lib/auth-client'
import { formatSize } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/admin/')({
  component: OverviewPage,
})

function OverviewPage() {
  const { t } = useTranslation()

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', { page: 1, pageSize: 1 }],
    queryFn: () => adminListUsers({ limit: 1, offset: 0 }),
  })

  const storagesQuery = useQuery({
    queryKey: ['admin', 'storages'],
    queryFn: listStorages,
  })

  const quotasQuery = useQuery({
    queryKey: ['admin', 'quotas'],
    queryFn: listQuotas,
  })

  const invitationsQuery = useQuery({
    queryKey: ['admin', 'site-invitations', { page: 1, pageSize: 100 }],
    queryFn: () => listSiteInvitations(1, 100),
  })

  const storages = storagesQuery.data?.items ?? []
  const activeStorages = storages.filter((storage) => storage.status === 'active')
  const quotaItems = quotasQuery.data?.items ?? []
  const quotaUsed = quotaItems.reduce((sum, item) => sum + item.used, 0)
  const quotaTotal = quotaItems.reduce((sum, item) => sum + item.quota, 0)
  const quotaPercent = quotaTotal > 0 ? Math.min(100, Math.round((quotaUsed / quotaTotal) * 100)) : 0
  const pendingInvitations = (invitationsQuery.data?.items ?? []).filter((invite) => invite.status === 'pending')
  const needsStorage = storages.length === 0
  const quotaWarning = quotaTotal > 0 && quotaPercent >= 80

  const metrics = [
    {
      title: t('admin.overview.metrics.users'),
      value: usersQuery.data?.total ?? '-',
      hint: t('admin.overview.metrics.usersHint'),
      icon: Users,
    },
    {
      title: t('admin.overview.metrics.storage'),
      value: `${activeStorages.length}/${storages.length}`,
      hint: t('admin.overview.metrics.storageHint'),
      icon: Database,
    },
    {
      title: t('admin.overview.metrics.quota'),
      value: quotaTotal > 0 ? `${quotaPercent}%` : '--',
      hint: quotaTotal > 0 ? `${formatSize(quotaUsed)} / ${formatSize(quotaTotal)}` : t('admin.overview.noQuota'),
      icon: Gauge,
    },
    {
      title: t('admin.overview.metrics.invites'),
      value: pendingInvitations.length,
      hint: t('admin.overview.metrics.invitesHint'),
      icon: MailPlus,
    },
  ]

  if (usersQuery.isLoading || storagesQuery.isLoading || quotasQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{t('admin.overview.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('admin.overview.subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.title} className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
              <metric.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{metric.value}</div>
              <p className="mt-1 truncate text-xs text-muted-foreground" title={String(metric.hint)}>
                {metric.hint}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>{t('admin.overview.capacityTitle')}</CardTitle>
            <CardDescription>{t('admin.overview.capacityDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <UsageBar
              label={t('admin.overview.orgQuota')}
              value={quotaPercent}
              description={quotaTotal > 0 ? `${formatSize(quotaUsed)} / ${formatSize(quotaTotal)}` : '--'}
            />

            <div className="grid gap-2 md:grid-cols-2">
              {storages.slice(0, 4).map((storage) => (
                <div key={storage.id} className="rounded-md border px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{storage.bucket}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {storage.status}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {storage.capacity > 0
                      ? `${formatSize(storage.used)} / ${formatSize(storage.capacity)}`
                      : formatSize(storage.used)}
                  </p>
                </div>
              ))}
              {storages.length === 0 && (
                <div className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  {t('admin.overview.noStorages')}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>{t('admin.overview.pendingTitle')}</CardTitle>
              <CardDescription>{t('admin.overview.pendingDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!needsStorage && !quotaWarning && pendingInvitations.length === 0 && (
                <div className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  {t('admin.overview.noPendingWork')}
                </div>
              )}
              {needsStorage && (
                <PendingItem
                  title={t('admin.overview.pending.storageTitle')}
                  description={t('admin.overview.pending.storageDescription')}
                  href="/admin/storages"
                />
              )}
              {quotaWarning && (
                <PendingItem
                  title={t('admin.overview.pending.quotaTitle')}
                  description={t('admin.overview.pending.quotaDescription', { percent: quotaPercent })}
                  href="/admin/users"
                />
              )}
              {pendingInvitations.length > 0 && (
                <PendingItem
                  title={t('admin.overview.pending.invitesTitle', { count: pendingInvitations.length })}
                  description={t('admin.overview.pending.invitesDescription')}
                  href="/admin/users"
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>{t('admin.overview.actionsTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <ActionLink href="/admin/users" icon={UserPlus} label={t('admin.overview.actions.manageUsers')} />
              <ActionLink href="/admin/storages" icon={Database} label={t('admin.overview.actions.configureStorage')} />
              <ActionLink href="/admin/settings" icon={Settings} label={t('admin.overview.actions.siteSettings')} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function UsageBar({ label, value, description }: { label: string; value: number; description: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="truncate text-muted-foreground" title={description}>
          {description}
        </span>
      </div>
      <Progress value={value} />
    </div>
  )
}

function PendingItem({
  title,
  description,
  href,
}: {
  title: string
  description: string
  href: '/admin/storages' | '/admin/users'
}) {
  return (
    <Link to={href} className="flex items-start gap-3 rounded-md border px-4 py-3 transition-colors hover:bg-muted/40">
      <div className="rounded-md bg-amber-500/10 p-2 text-amber-600">
        <AlertTriangle className="h-4 w-4" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </Link>
  )
}

function ActionLink({
  href,
  icon: Icon,
  label,
}: {
  href: '/admin/users' | '/admin/storages' | '/admin/settings'
  icon: typeof UserPlus
  label: string
}) {
  return (
    <Button variant="outline" className="justify-start" asChild>
      <Link to={href}>
        <Icon className="mr-2 h-4 w-4" />
        {label}
        <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
      </Link>
    </Button>
  )
}
