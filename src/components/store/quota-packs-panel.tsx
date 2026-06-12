import type { CloudStoreTarget } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Package } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiError, listMyEntitlements, type MyEntitlement, transferMyEntitlement } from '@/lib/api'
import { formatSize } from '@/lib/format'

interface QuotaPacksPanelProps {
  targets: CloudStoreTarget[]
  currentOrgId: string
}

// Lists the current space's purchased one-time storage packs and lets the
// owner move whole packs to another space they own (design doc §2.2).
export function QuotaPacksPanel({ targets, currentOrgId }: QuotaPacksPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [moveTarget, setMoveTarget] = useState<MyEntitlement | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState('')

  const entitlementsQuery = useQuery({
    queryKey: ['user', 'quota', 'entitlements', currentOrgId],
    queryFn: listMyEntitlements,
    retry: false,
  })

  const ownedTargets = targets.filter((target) => target.role === 'owner' && target.orgId !== currentOrgId)

  const transferMutation = useMutation({
    mutationFn: () => transferMyEntitlement(moveTarget!.id, selectedOrgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      toast.success(t('storage.packMoved'))
      setMoveTarget(null)
      setSelectedOrgId('')
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body.code === 'SOURCE_OVER_QUOTA') {
        toast.error(t('storage.packMoveOverQuota'))
      } else {
        toast.error(err.message)
      }
    },
  })

  const packs = (entitlementsQuery.data?.items ?? []).filter((item) => item.transferable)
  if (packs.length === 0 || ownedTargets.length === 0) return null

  return (
    <div className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Package className="h-4 w-4 text-muted-foreground" />
        {t('storage.packsTitle')}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('storage.packsDescription')}</p>
      <ul className="mt-3 divide-y divide-border/60">
        {packs.map((pack) => (
          <li key={pack.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <span className="font-medium tabular-nums">{formatSize(pack.bytes)}</span>
              {pack.expiresAt && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {t('storage.packExpires', { date: new Date(pack.expiresAt).toLocaleDateString() })}
                </span>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => setMoveTarget(pack)}>
              <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
              {t('storage.packMove')}
            </Button>
          </li>
        ))}
      </ul>

      <Dialog
        open={!!moveTarget}
        onOpenChange={(open) => {
          if (!open) {
            setMoveTarget(null)
            setSelectedOrgId('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('storage.packMoveTitle', { size: formatSize(moveTarget?.bytes ?? 0) })}</DialogTitle>
            <DialogDescription>{t('storage.packMoveDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 py-2">
            <Label>{t('storage.packMoveTargetLabel')}</Label>
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger>
                <SelectValue placeholder={t('storage.packMoveTargetPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {ownedTargets.map((target) => (
                  <SelectItem key={target.orgId} value={target.orgId}>
                    {target.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTarget(null)} disabled={transferMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => transferMutation.mutate()} disabled={transferMutation.isPending || !selectedOrgId}>
              {transferMutation.isPending ? t('common.loading') : t('storage.packMoveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
