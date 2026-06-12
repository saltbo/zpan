import type { OrgQuotaEntitlement } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { GrantOrgEntitlementDialog } from '@/components/admin/grant-org-entitlement-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listOrgEntitlements, listQuotas, type QuotaItem, revokeOrgEntitlement } from '@/lib/api'
import { formatSize } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/admin/quotas')({
  component: AdminQuotasPage,
})

type ManagedOrg = { orgId: string; name: string }

function AdminQuotasPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [managedOrg, setManagedOrg] = useState<ManagedOrg | null>(null)
  const [grantOpen, setGrantOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<OrgQuotaEntitlement | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<OrgQuotaEntitlement | null>(null)

  const quotasQuery = useQuery({ queryKey: ['admin', 'quotas'], queryFn: listQuotas })

  const entitlementsQuery = useQuery({
    queryKey: ['admin', 'quotas', managedOrg?.orgId, 'entitlements'],
    queryFn: () => listOrgEntitlements(managedOrg!.orgId),
    enabled: !!managedOrg,
  })

  const revokeMutation = useMutation({
    mutationFn: (entitlementId: string) => revokeOrgEntitlement(managedOrg!.orgId, entitlementId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'quotas'] })
      toast.success(t('admin.quotas.entitlementRevoked'))
      setRevokeTarget(null)
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const items = quotasQuery.data?.items ?? []

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{t('admin.quotas.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('admin.quotas.subtitle')}</p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.quotas.orgColumn')}</TableHead>
            <TableHead>{t('admin.quotas.typeColumn')}</TableHead>
            <TableHead>{t('admin.quotas.usageColumn')}</TableHead>
            <TableHead className="text-right">{t('admin.quotas.actionsColumn')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.orgId}>
              <TableCell className="font-medium">{item.orgName ?? item.orgId}</TableCell>
              <TableCell>
                <Badge variant={item.orgType === 'team' ? 'default' : 'outline'}>
                  {item.orgType === 'team' ? t('admin.quotas.typeTeam') : t('admin.quotas.typePersonal')}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">{formatUsage(item)}</TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setManagedOrg({ orgId: item.orgId, name: item.orgName ?? item.orgId })}
                >
                  {t('admin.quotas.manage')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                {quotasQuery.isLoading ? t('common.loading') : t('admin.quotas.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={!!managedOrg && !grantOpen && !editTarget} onOpenChange={(open) => !open && setManagedOrg(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('admin.quotas.entitlementsFor', { name: managedOrg?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('admin.quotas.entitlementsDescription')}</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.quotas.entitlementSource')}</TableHead>
                <TableHead>{t('admin.quotas.entitlementBytes')}</TableHead>
                <TableHead>{t('admin.quotas.entitlementStatus')}</TableHead>
                <TableHead className="text-right">{t('admin.quotas.actionsColumn')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(entitlementsQuery.data?.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.source}</TableCell>
                  <TableCell className="tabular-nums">{formatSize(item.bytes)}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'active' ? 'default' : 'outline'}>{item.status}</Badge>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {item.source === 'admin_grant' && item.status === 'active' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditTarget(item)}>
                          {t('common.edit')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(item)}>
                          {t('admin.quotas.revoke')}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(entitlementsQuery.data?.items ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    {entitlementsQuery.isLoading ? t('common.loading') : t('admin.quotas.noEntitlements')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManagedOrg(null)}>
              {t('common.close')}
            </Button>
            <Button onClick={() => setGrantOpen(true)}>{t('admin.quotas.grantEntitlement')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GrantOrgEntitlementDialog open={grantOpen} onOpenChange={setGrantOpen} org={managedOrg} />
      <GrantOrgEntitlementDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        org={managedOrg}
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
            <DialogTitle>{t('admin.quotas.revokeTitle')}</DialogTitle>
            <DialogDescription>{t('admin.quotas.revokeConfirm', { name: managedOrg?.name ?? '' })}</DialogDescription>
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
              {revokeMutation.isPending ? t('common.loading') : t('admin.quotas.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatUsage(item: QuotaItem): string {
  if (item.quota <= 0) return `${formatSize(item.used)} / ∞`
  return `${formatSize(item.used)} / ${formatSize(item.quota)}`
}
