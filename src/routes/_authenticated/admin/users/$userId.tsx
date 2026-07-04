import type { AdminAuditEvent, OrgQuotaEntitlement } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Activity, ArrowLeft, BadgeCent, CalendarDays, Mail } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_FILTER_ALL,
  AuditLogFilters,
  AuditPagination,
  type AuditTimeRange,
  auditActionToFilter,
  auditTimeRangeToFilter,
} from '@/components/admin/audit-log-controls'
import { GrantEntitlementDialog } from '@/components/admin/grant-entitlement-dialog'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useEntitlement } from '@/hooks/useEntitlement'
import {
  type AdminAuditFilter,
  getUserQuotaById,
  listAdminAuditLogs,
  listUserEntitlements,
  revokeUserEntitlement,
} from '@/lib/api'
import { adminGetUser } from '@/lib/auth-client'
import { formatDate, formatSize, formatStorageUsage, getInitials } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/admin/users/$userId')({
  component: AdminUserDetailPage,
})

export function AdminUserDetailPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { userId } = Route.useParams()
  const [grantOpen, setGrantOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<OrgQuotaEntitlement | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<OrgQuotaEntitlement | null>(null)
  const [activityPage, setActivityPage] = useState(1)
  const [activityPageSize, setActivityPageSize] = useState(AUDIT_DEFAULT_PAGE_SIZE)
  const [activityAction, setActivityAction] = useState(AUDIT_FILTER_ALL)
  const [activityTimeRange, setActivityTimeRange] = useState<AuditTimeRange>('all')
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const auditEnabled = hasFeature('audit_log')

  const userQuery = useQuery({
    queryKey: ['admin', 'users', userId],
    queryFn: () => adminGetUser(userId),
  })

  const quotaQuery = useQuery({
    queryKey: ['admin', 'user-quotas', userId],
    queryFn: () => getUserQuotaById(userId),
  })

  const revokeMutation = useMutation({
    mutationFn: (entitlementId: string) => revokeUserEntitlement(userId, entitlementId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'entitlements'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'activity'] })
      toast.success(t('admin.users.entitlementRevoked'))
      setRevokeTarget(null)
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const entitlementsQuery = useQuery({
    queryKey: ['admin', 'users', userId, 'entitlements'],
    queryFn: () => listUserEntitlements(userId),
  })

  const activityFilter = useMemo<AdminAuditFilter>(() => {
    const action = auditActionToFilter(activityAction)
    return {
      userId,
      ...(action ? { action } : {}),
      ...auditTimeRangeToFilter(activityTimeRange),
    }
  }, [userId, activityAction, activityTimeRange])

  const activityQuery = useQuery({
    queryKey: ['admin', 'users', userId, 'activity', activityPage, activityPageSize, activityAction, activityTimeRange],
    queryFn: () => listAdminAuditLogs(activityPage, activityPageSize, activityFilter),
    enabled: auditEnabled && userQuery.isSuccess,
  })

  const user = userQuery.data
  const items = useMemo(
    () => (entitlementsQuery.data?.items ?? []).filter((item) => item.resourceType === 'storage'),
    [entitlementsQuery.data?.items],
  )
  const displayName = user ? user.name || user.username || user.email : ''
  const statusLabel = user?.banned ? t('admin.users.disabled') : t('admin.users.active')
  const statusVariant = user?.banned ? 'destructive' : 'secondary'
  const quota = quotaQuery.data
  const hasPersonalOrg = quota?.hasPersonalOrg ?? false
  const quotaLabel = quota?.hasPersonalOrg ? formatStorageUsage(quota.used, quota.total) : '—'

  const activeItems = useMemo(() => items.filter((item) => item.status === 'active'), [items])
  const activityItems = activityQuery.data?.items ?? []
  const activityTotal = activityQuery.data?.total ?? 0

  function handleActivityActionChange(value: string) {
    setActivityAction(value)
    setActivityPage(1)
  }

  function handleActivityTimeRangeChange(value: AuditTimeRange) {
    setActivityTimeRange(value)
    setActivityPage(1)
  }

  function handleActivityPageSizeChange(value: number) {
    setActivityPageSize(value)
    setActivityPage(1)
  }

  if (userQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <Button variant="outline" asChild>
          <Link to="/admin/users">
            <ArrowLeft />
            {t('admin.users.backToUsers')}
          </Link>
        </Button>
        <div className="rounded-md border px-4 py-8 text-center text-muted-foreground">
          {userQuery.error?.message ?? t('admin.users.userNotFound')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" asChild>
          <Link to="/admin/users">
            <ArrowLeft />
            {t('admin.users.backToUsers')}
          </Link>
        </Button>
      </div>

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>{t('admin.users.userDetails')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar className="h-14 w-14">
                {user.image && <AvatarImage src={user.image} alt={displayName} />}
                <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-semibold">{displayName}</h2>
                  <Badge variant={statusVariant}>{statusLabel}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-4 w-4" />
                    {user.email}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4" />
                    {formatDate(user.createdAt)}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 md:min-w-[420px]">
              <Metric label={t('admin.users.colRole')} value={roleLabel(user.role, t)} />
              <Metric label={t('admin.users.colQuota')} value={quotaLabel} />
              <Metric label={t('admin.users.activeEntitlements')} value={String(activeItems.length)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="activity" className="gap-4">
        <TabsList>
          <TabsTrigger value="activity">{t('activity.title')}</TabsTrigger>
          <TabsTrigger value="entitlement">{t('admin.users.tabEntitlement')}</TabsTrigger>
        </TabsList>

        <TabsContent value="activity">
          <Card className="rounded-md">
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <Activity className="h-5 w-5" />
                {t('activity.title')}
              </CardTitle>
              <CardAction>
                <ProBadge tooltip={t('admin.audit.proTooltip')} />
              </CardAction>
            </CardHeader>
            <CardContent>
              {entitlementLoading ? (
                <div className="py-6 text-sm text-muted-foreground">{t('common.loading')}</div>
              ) : !auditEnabled ? (
                <UpgradeHint
                  feature="audit_log"
                  title={t('admin.audit.upgradeTitle')}
                  description={t('admin.audit.upgradeDescription')}
                  actionLabel={t('admin.audit.upgradeButton')}
                />
              ) : (
                <div className="space-y-4">
                  <AuditLogFilters
                    action={activityAction}
                    timeRange={activityTimeRange}
                    disabled={activityQuery.isFetching}
                    onActionChange={handleActivityActionChange}
                    onTimeRangeChange={handleActivityTimeRangeChange}
                  />
                  <UserActivityFeed
                    events={activityItems}
                    isLoading={activityQuery.isPending}
                    isError={activityQuery.isError}
                  />
                  {!activityQuery.isPending && !activityQuery.isError && (
                    <AuditPagination
                      page={activityPage}
                      pageSize={activityPageSize}
                      total={activityTotal}
                      disabled={activityQuery.isFetching}
                      onPageChange={setActivityPage}
                      onPageSizeChange={handleActivityPageSizeChange}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="entitlement">
          <Card className="rounded-md">
            <CardHeader>
              <CardTitle>{t('admin.users.entitlements')}</CardTitle>
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => setGrantOpen(true)} disabled={!hasPersonalOrg}>
                  <BadgeCent />
                  {t('admin.users.addEntitlement')}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.users.entitlementType')}</TableHead>
                    <TableHead>{t('admin.users.entitlementAmount')}</TableHead>
                    <TableHead>{t('admin.users.entitlementSource')}</TableHead>
                    <TableHead>{t('admin.users.entitlementExpires')}</TableHead>
                    <TableHead>{t('admin.users.entitlementStatus')}</TableHead>
                    <TableHead className="text-right">{t('admin.users.entitlementActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{formatEntitlementType(item.entitlementType, t)}</TableCell>
                      <TableCell className="font-medium tabular-nums">{formatSize(item.bytes)}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-muted-foreground" title={item.sourceId}>
                        {formatSource(item.source, t)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.expiresAt ? formatDate(item.expiresAt) : t('admin.users.noExpiry')}
                      </TableCell>
                      <TableCell>{formatStatus(item.status, t)}</TableCell>
                      <TableCell className="text-right">
                        {isEditable(item) && (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setEditTarget(item)}>
                              {t('admin.users.editEntitlement')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setRevokeTarget(item)}
                            >
                              {t('admin.users.revokeEntitlement')}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {entitlementsQuery.isLoading ? t('common.loading') : t('admin.users.noEntitlements')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <GrantEntitlementDialog
        open={grantOpen}
        onOpenChange={setGrantOpen}
        target={{ kind: 'user', id: user.id, name: displayName }}
      />

      <GrantEntitlementDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={{ kind: 'user', id: user.id, name: displayName }}
        entitlement={editTarget}
      />

      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.users.revokeEntitlementTitle')}</DialogTitle>
            <DialogDescription>{t('admin.users.revokeEntitlementConfirm', { name: displayName })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)} disabled={revokeMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? t('common.loading') : t('admin.users.revokeEntitlement')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function UserActivityFeed({
  events,
  isLoading,
  isError,
}: {
  events: AdminAuditEvent[]
  isLoading: boolean
  isError: boolean
}) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="space-y-3" role="status">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 py-3">
            <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {t('activity.loadError')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {events.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {t('activity.empty')}
        </div>
      ) : (
        <div className="divide-y rounded-md border px-4">
          {events.map((event) => (
            <UserActivityItem key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

function UserActivityItem({ event }: { event: AdminAuditEvent }) {
  const { t } = useTranslation()
  const metadata = parseActivityMetadata(event.metadata)
  const status = metadata?.status ?? metadata?.result
  const metadataDetails = metadata
    ? Object.entries(metadata).filter(([key, value]) => !['status', 'result', 'from', 'to'].includes(key) && value)
    : []
  const targetName = event.targetName || event.targetId || event.targetType

  return (
    <div className="flex items-start gap-3 py-3">
      <Avatar className="h-8 w-8 flex-shrink-0">
        {event.user.image && <AvatarImage src={event.user.image} alt={event.user.name} />}
        <AvatarFallback className="text-xs">{getInitials(event.user.name || event.userId)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(`activity.action.${event.action}`, { defaultValue: event.action })}</Badge>
          {status && <Badge variant="outline">{status}</Badge>}
          <span className="min-w-0 truncate text-sm font-medium" title={targetName}>
            {t(`activity.target.${event.targetType}`, { defaultValue: event.targetType })}: {targetName}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{formatTimestamp(event.createdAt)}</span>
          {event.orgName && <span>{event.orgName}</span>}
          {event.targetId && <span>{event.targetId}</span>}
        </div>
        {metadata && (metadata.from || metadata.to || metadataDetails.length > 0) && (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {metadata.from && (
              <span>
                {t('activity.meta.from')}: {metadata.from}
              </span>
            )}
            {metadata.to && (
              <span>
                {t('activity.meta.to')}: {metadata.to}
              </span>
            )}
            {metadataDetails.map(([key, value]) => (
              <span key={key}>
                {key}: {value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function parseActivityMetadata(metadata: string | null): Record<string, string> | null {
  if (!metadata) return null

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, formatMetadataValue(value)]))
  } catch {
    return null
  }
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function isEditable(item: OrgQuotaEntitlement): boolean {
  return item.source === 'admin_grant' && item.status === 'active'
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  )
}

function roleLabel(role: string | null, t: (key: string) => string): string {
  return role === 'admin' ? t('admin.users.roleAdmin') : t('admin.users.roleMember')
}

function formatEntitlementType(type: string, t: (key: string) => string): string {
  if (type === 'plan') return t('admin.users.entitlementTypePlan')
  return t('admin.users.entitlementTypeGrant')
}

function formatSource(source: string, t: (key: string) => string): string {
  if (source === 'admin_grant') return t('admin.users.entitlementSourceAdmin')
  if (source === 'free_plan') return t('admin.users.entitlementSourceFreePlan')
  if (source === 'cloud_order') return t('admin.users.entitlementSourceOrder')
  return source
}

function formatStatus(status: string, t: (key: string) => string): string {
  if (status === 'active') return t('admin.users.active')
  if (status === 'revoked') return t('admin.users.revoked')
  return status
}
