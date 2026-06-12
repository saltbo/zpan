import type { OrgQuotaEntitlement } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, BadgeCent, CalendarDays, UsersRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { GrantEntitlementDialog } from '@/components/admin/grant-entitlement-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { getTeam, listOrgEntitlements, revokeOrgEntitlement } from '@/lib/api'
import { formatDate, formatSize, formatStorageUsage, getInitials } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/admin/teams/$orgId')({
  component: AdminTeamDetailPage,
})

function AdminTeamDetailPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { orgId } = Route.useParams()
  const [grantOpen, setGrantOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<OrgQuotaEntitlement | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<OrgQuotaEntitlement | null>(null)

  const teamQuery = useQuery({
    queryKey: ['admin', 'teams', orgId],
    queryFn: () => getTeam(orgId),
  })

  const entitlementsQuery = useQuery({
    queryKey: ['admin', 'teams', orgId, 'entitlements'],
    queryFn: () => listOrgEntitlements(orgId),
  })

  const revokeMutation = useMutation({
    mutationFn: (entitlementId: string) => revokeOrgEntitlement(orgId, entitlementId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'teams'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'teams', orgId, 'entitlements'] })
      toast.success(t('admin.teams.entitlementRevoked'))
      setRevokeTarget(null)
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const team = teamQuery.data
  const items = useMemo(
    () => (entitlementsQuery.data?.items ?? []).filter((item) => item.resourceType === 'storage'),
    [entitlementsQuery.data?.items],
  )
  const activeItems = useMemo(() => items.filter((item) => item.status === 'active'), [items])

  if (teamQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  if (!team) {
    return (
      <div className="space-y-4">
        <Button variant="outline" asChild>
          <Link to="/admin/teams">
            <ArrowLeft />
            {t('admin.teams.backToTeams')}
          </Link>
        </Button>
        <div className="rounded-md border px-4 py-8 text-center text-muted-foreground">
          {teamQuery.error?.message ?? t('admin.teams.teamNotFound')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Button variant="outline" asChild>
        <Link to="/admin/teams">
          <ArrowLeft />
          {t('admin.teams.backToTeams')}
        </Link>
      </Button>

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>{t('admin.teams.teamDetails')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar className="h-14 w-14">
                {team.logo && <AvatarImage src={team.logo} alt={team.name} />}
                <AvatarFallback>{getInitials(team.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-semibold">{team.name}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <UsersRound className="h-4 w-4" />
                    {t('admin.teams.memberCount', { count: team.memberCount })}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4" />
                    {formatDate(team.createdAt)}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 md:min-w-[420px]">
              <Metric label={t('admin.teams.colOwner')} value={team.ownerName ?? '—'} />
              <Metric label={t('admin.teams.colUsage')} value={formatStorageUsage(team.quotaUsed, team.quotaTotal)} />
              <Metric label={t('admin.teams.activeEntitlements')} value={String(activeItems.length)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>{t('admin.teams.entitlements')}</CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setGrantOpen(true)}>
              <BadgeCent />
              {t('admin.teams.addEntitlement')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.teams.entitlementType')}</TableHead>
                <TableHead>{t('admin.teams.entitlementAmount')}</TableHead>
                <TableHead>{t('admin.teams.entitlementSource')}</TableHead>
                <TableHead>{t('admin.teams.entitlementExpires')}</TableHead>
                <TableHead>{t('admin.teams.entitlementStatus')}</TableHead>
                <TableHead className="text-right">{t('admin.teams.entitlementActions')}</TableHead>
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
                    {item.expiresAt ? formatDate(item.expiresAt) : t('admin.teams.noExpiry')}
                  </TableCell>
                  <TableCell>{formatStatus(item.status, t)}</TableCell>
                  <TableCell className="text-right">
                    {isEditable(item) && (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditTarget(item)}>
                          {t('admin.teams.editEntitlement')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRevokeTarget(item)}
                        >
                          {t('admin.teams.revokeEntitlement')}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {entitlementsQuery.isLoading ? t('common.loading') : t('admin.teams.noEntitlements')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <GrantEntitlementDialog
        open={grantOpen}
        onOpenChange={setGrantOpen}
        target={{ kind: 'team', orgId: team.id, name: team.name }}
      />

      <GrantEntitlementDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={{ kind: 'team', orgId: team.id, name: team.name }}
        entitlement={
          editTarget
            ? {
                id: editTarget.id,
                bytes: editTarget.bytes,
                expiresAt: editTarget.expiresAt ? String(editTarget.expiresAt) : null,
                metadata: editTarget.metadata,
              }
            : null
        }
      />

      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.teams.revokeEntitlementTitle')}</DialogTitle>
            <DialogDescription>{t('admin.teams.revokeEntitlementConfirm', { name: team.name })}</DialogDescription>
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
              {revokeMutation.isPending ? t('common.loading') : t('admin.teams.revokeEntitlement')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
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

function formatEntitlementType(type: string, t: (key: string) => string): string {
  if (type === 'plan') return t('admin.teams.entitlementTypePlan')
  return t('admin.teams.entitlementTypeGrant')
}

function formatSource(source: string, t: (key: string) => string): string {
  if (source === 'admin_grant') return t('admin.teams.entitlementSourceAdmin')
  if (source === 'free_plan') return t('admin.teams.entitlementSourceFreePlan')
  if (source === 'cloud_order') return t('admin.teams.entitlementSourceOrder')
  return source
}

function formatStatus(status: string, t: (key: string) => string): string {
  if (status === 'active') return t('admin.teams.active')
  if (status === 'revoked') return t('admin.teams.revoked')
  return status
}
