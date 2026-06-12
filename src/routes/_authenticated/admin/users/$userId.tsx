import type { OrgQuotaEntitlement } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, BadgeCent, CalendarDays, Mail } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { GrantEntitlementDialog } from '@/components/admin/grant-entitlement-dialog'
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
import { getUser, listUserEntitlements, revokeUserEntitlement } from '@/lib/api'
import { formatDate, formatSize, formatStorageUsage, getInitials } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/admin/users/$userId')({
  component: AdminUserDetailPage,
})

function AdminUserDetailPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { userId } = Route.useParams()
  const [grantOpen, setGrantOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<OrgQuotaEntitlement | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<OrgQuotaEntitlement | null>(null)

  const userQuery = useQuery({
    queryKey: ['admin', 'users', userId],
    queryFn: () => getUser(userId),
  })

  const revokeMutation = useMutation({
    mutationFn: (entitlementId: string) => revokeUserEntitlement(userId, entitlementId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'entitlements'] })
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

  const user = userQuery.data
  const items = useMemo(
    () => (entitlementsQuery.data?.items ?? []).filter((item) => item.resourceType === 'storage'),
    [entitlementsQuery.data?.items],
  )
  const displayName = user ? user.name || user.username || user.email : ''
  const statusLabel = user?.banned ? t('admin.users.disabled') : t('admin.users.active')
  const statusVariant = user?.banned ? 'destructive' : 'secondary'
  const quotaLabel = user ? formatStorageUsage(user.quotaUsed, user.quotaTotal) : ''

  const activeItems = useMemo(() => items.filter((item) => item.status === 'active'), [items])

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

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>{t('admin.users.entitlements')}</CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setGrantOpen(true)} disabled={!user.orgId}>
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
